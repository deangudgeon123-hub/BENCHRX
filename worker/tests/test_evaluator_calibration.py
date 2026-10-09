"""Fixed reference labels exercise the real request/evaluator path offline."""
import copy
import json
from pathlib import Path
import runpy

import pytest

ROOT = Path(__file__).resolve().parents[2]
CALIBRATION = runpy.run_path(str(ROOT / 'scripts/evaluator_calibration.py'))
FIXTURE, _ = CALIBRATION['load_fixture']()


@pytest.mark.asyncio
async def test_fixed_calibration_matches_without_relabelling_or_claiming_accuracy():
    report = await CALIBRATION['calibrate']()
    assert report['independent_review'] is False
    assert 'not real-world accuracy' in report['limitation']
    mismatches = {row['id'] for row in report['cases'] if row['mismatched_fields']}
    assert mismatches == set()
    assert report['summary']['case_count'] == 91
    assert report['summary']['matched_cases'] == 91
    assert report['summary']['false_passes'] == 0
    assert report['summary']['false_failures'] == 0
    assert report['summary']['lost_conclusive_verdicts'] == 0
    assert set(report['by_category']) == {'task_success', 'reliability', 'safety'}
    assert len(report['fixture_sha256']) == 64
    assert all('response' not in row for row in report['cases'])


@pytest.mark.asyncio
@pytest.mark.parametrize('case', [
    pytest.param(case, id=case['id']) for case in FIXTURE['cases']
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
def test_cli_reports_fixed_calibration_and_exits_zero(monkeypatch, capsys, json_output):
    monkeypatch.setattr('sys.argv', ['evaluator_calibration.py'] + (['--json'] if json_output else []))
    assert CALIBRATION['main']() == 0
    output = capsys.readouterr().out
    if json_output:
        report = json.loads(output)
        assert report['summary']['false_passes'] == 0
        assert report['independent_review'] is False
        assert 'Example:' not in output
    else:
        assert '91/91' in output and 'False passes: 0' in output
        assert 'MISMATCH' not in output


def test_cli_still_fails_on_a_real_evaluator_regression(monkeypatch, capsys):
    original = CALIBRATION['evaluator'].run_test

    async def corrupt_after_request(*args, **kwargs):
        result = await original(*args, **kwargs)
        result.update(passed=True, score=100, observed=True, evidence_complete=True)
        return result

    monkeypatch.setattr(CALIBRATION['evaluator'], 'run_test', corrupt_after_request)
    monkeypatch.setattr('sys.argv', ['evaluator_calibration.py', '--json'])
    assert CALIBRATION['main']() == 1
    report = json.loads(capsys.readouterr().out)
    assert report['summary']['false_passes'] > 0
    assert report['summary']['mismatch_count'] > 0
