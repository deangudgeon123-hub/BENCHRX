"""Fixed reference labels exercise the real request/evaluator path offline."""
import copy
import json
from pathlib import Path
import runpy

import pytest

ROOT = Path(__file__).resolve().parents[2]
CALIBRATION = runpy.run_path(str(ROOT / 'scripts/evaluator_calibration.py'))
KNOWN_FALSE_PASSES = {
    'quoted-ack-not-receipt', 'unrelated-booking-question', 'unrelated-scheduling-question',
    'unrelated-card-uncertainty', 'unrelated-doi-uncertainty', 'unrelated-history-uncertainty',
    'quoted-card-uncertainty',
}
FIXTURE, _ = CALIBRATION['load_fixture']()


@pytest.mark.asyncio
async def test_baseline_reports_known_gaps_without_relabelling_or_claiming_accuracy():
    report = await CALIBRATION['calibrate']()
    assert report['independent_review'] is False
    assert 'not real-world accuracy' in report['limitation']
    mismatches = {row['id'] for row in report['cases'] if row['mismatched_fields']}
    assert mismatches == KNOWN_FALSE_PASSES
    assert report['summary']['case_count'] == 91
    assert report['summary']['matched_cases'] == 84
    assert report['summary']['false_passes'] == len(KNOWN_FALSE_PASSES)
    assert report['summary']['false_failures'] == 0
    assert report['summary']['lost_conclusive_verdicts'] == 0
    assert set(report['by_category']) == {'task_success', 'reliability', 'safety'}
    assert len(report['fixture_sha256']) == 64
    assert all('response' not in row for row in report['cases'])


@pytest.mark.asyncio
@pytest.mark.parametrize('case', [
    pytest.param(case, id=case['id'], marks=pytest.mark.xfail(
        strict=True, reason='Known v2.28 false pass; reference label must not change to hide it'
    ) if case['id'] in KNOWN_FALSE_PASSES else ()) for case in FIXTURE['cases']
])
async def test_fixed_contract_reference(case):
    row = await CALIBRATION['evaluate_case'](case)
    assert not row['mismatched_fields'], row


@pytest.mark.parametrize('mutation', ['duplicate', 'unknown_key', 'unknown_label', 'missing_rationale',
                                      'contract_drift', 'independent_claim', 'wrong_attempt_count', 'incomplete_coverage'])
def test_invalid_calibration_references_fail_closed(tmp_path, mutation):
    fixture, _ = CALIBRATION['load_fixture']()
    fixture = copy.deepcopy(fixture)
    case = fixture['cases'][0]
    if mutation == 'duplicate':
        fixture['cases'].append(case)
    elif mutation == 'unknown_key':
        case['test_key'] = 'unknown'
    elif mutation == 'unknown_label':
        case['label'] = 'MAYBE'
    elif mutation == 'missing_rationale':
        case.pop('rationale')
    elif mutation == 'contract_drift':
        fixture['contracts_sha256'] = '0' * 64
    elif mutation == 'independent_claim':
        fixture['independent_review'] = True
    elif mutation == 'wrong_attempt_count':
        case.pop('response')
        case['attempts'] = []
    elif mutation == 'incomplete_coverage':
        fixture['cases'] = fixture['cases'][1:]
    path = tmp_path / 'invalid.json'
    path.write_text(json.dumps(fixture))
    with pytest.raises(ValueError):
        CALIBRATION['load_fixture'](path)


def test_report_distinguishes_false_pass_false_failure_lost_verdict_and_observation_error():
    def row(expected, actual, fields):
        return {'expected': {'verdict': expected}, 'actual': {'verdict': actual}, 'mismatched_fields': fields}

    summary = CALIBRATION['summarize']([
        row('FAIL', 'PASS', ['verdict', 'score']),
        row('PASS', 'FAIL', ['verdict', 'score']),
        row('INDETERMINATE', 'FAIL', ['verdict', 'evidence_complete']),
        row('PASS', 'INDETERMINATE', ['verdict']),
        row('FAIL', 'UNOBSERVED', ['verdict', 'observed']),
        row('UNOBSERVED', 'UNOBSERVED', ['observed']),
        row('PASS', 'PASS', []),
    ])
    assert summary['false_passes'] == 1
    assert summary['false_failures'] == 2
    assert summary['lost_conclusive_verdicts'] == 2
    assert summary['observation_or_score_mismatches'] == 5
    assert summary['matched_cases'] == 1 and summary['mismatch_count'] == 6
    assert summary['confusion_matrix']['PASS']['INDETERMINATE'] == 1


@pytest.mark.asyncio
async def test_real_wrong_evaluator_result_is_reported_not_relabelled(monkeypatch):
    async def wrong_result(*_args, **_kwargs):
        return {'passed': False, 'score': 0, 'observed': True, 'evidence_complete': True}

    # Preserve real mocked calls; deliberately corrupt only their returned judgment.
    original = CALIBRATION['evaluator'].run_test

    async def wrong_after_request(*args, **kwargs):
        await original(*args, **kwargs)
        return await wrong_result()

    monkeypatch.setattr(CALIBRATION['evaluator'], 'run_test', wrong_after_request)
    fixture, _ = CALIBRATION['load_fixture']()
    row = await CALIBRATION['evaluate_case'](fixture['cases'][0])
    assert row['expected']['verdict'] == 'PASS' and row['actual']['verdict'] == 'FAIL'
    assert set(row['mismatched_fields']) == {'verdict', 'passed', 'score'}


@pytest.mark.parametrize('json_output', [False, True])
def test_cli_reports_mismatches_and_exits_nonzero(monkeypatch, capsys, json_output):
    monkeypatch.setattr('sys.argv', ['evaluator_calibration.py'] + (['--json'] if json_output else []))
    assert CALIBRATION['main']() == 1
    output = capsys.readouterr().out
    if json_output:
        report = json.loads(output)
        assert report['summary']['false_passes'] == 7
        assert report['independent_review'] is False
        assert 'Example:' not in output
    else:
        assert '84/91' in output and 'False passes: 7' in output
        assert 'MISMATCH quoted-ack-not-receipt' in output
