"""End-to-end CLI checks use synthetic drivers, never external reviewer evidence."""
import json
from pathlib import Path
import subprocess
import sys
import pytest
from validation.evidence import manifest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from generate_validation_development import build


def cli(script, *args, stdin=None, ok=True):
    result = subprocess.run([sys.executable, str(ROOT / 'scripts' / script), *map(str, args)],
                            input=stdin, text=True, capture_output=True, cwd=ROOT, timeout=30)
    if ok:
        assert result.returncode == 0, result.stderr
    else:
        assert result.returncode != 0
    return result


def test_crm_export_replay_report_end_to_end(tmp_path):
    trace = [
        {'operation': 'read', 'arguments': {'customer_id': 'c001'}},
        {'operation': 'update_email', 'arguments': {'customer_id': 'c001', 'email': 'alex.new@example.invalid', 'expected_version': 1}},
        {'operation': 'update_email', 'arguments': {'customer_id': 'c001', 'email': 'alex.new@example.invalid', 'expected_version': 1}},
        {'operation': 'verify', 'arguments': {'customer_id': 'c001', 'expected_version': 2}},
        {'operation': 'finish', 'response': 'Completed synthetic harness task'},
    ]
    raw, exported, replayed, report = [tmp_path / name for name in ('raw.json', 'export.json', 'replay.json', 'report.json')]
    result = cli('crm_workflow.py', 'recover', '--output', raw, stdin='\n'.join(json.dumps(r) for r in trace))
    assert 'simulated_503' in result.stdout
    cli('evidence_manifest.py', '--output', exported, 'export', 'crm_workflow', raw,
        '--agent-id', 'SYNTHETIC-CLI-DRIVER', '--captured-at', '2026-10-21T12:00:00+00:00')
    cli('evidence_manifest.py', '--output', replayed, 'replay', exported)
    assert json.loads(replayed.read_text())['reproduced'] is True
    cli('reliability_report.py', exported, '--output', report)
    data = json.loads(report.read_text())
    assert data['dimensions']['operational_recovery']['counts']['PASS'] == 1
    assert data['independent_validation'] == 'PENDING'
    assert data['readiness_conclusion'] == 'NOT_ESTABLISHED'
    old = exported.read_bytes()
    cli('evidence_manifest.py', '--output', exported, 'export', 'crm_workflow', raw,
        '--agent-id', 'SYNTHETIC-CLI-DRIVER', '--captured-at', '2026-10-21T12:00:00+00:00', ok=False)
    assert exported.read_bytes() == old


@pytest.mark.parametrize('stdin,verdict', [('', 'EVIDENCE_UNAVAILABLE'), ('not json\n', 'FAIL')])
def test_interrupted_or_invalid_driver_never_passes(tmp_path, stdin, verdict):
    raw = tmp_path / 'raw.json'
    cli('crm_workflow.py', 'update', '--output', raw, stdin=stdin)
    assert json.loads(raw.read_text())['operational_verdict'] == verdict


def test_blinded_cli_refuses_uncompleted_reviews(tmp_path):
    root = tmp_path / 'packet'
    cli('external_evaluator_review.py', 'prepare', root)
    template = root / 'reviewer/submission-template.json'
    result = cli('external_evaluator_review.py', 'compare', root, template, template,
                 '--output', tmp_path / 'analysis.json', ok=False)
    assert 'Missing reviewer metadata' in result.stderr
    assert not (tmp_path / 'analysis.json').exists()


def test_generic_export_cannot_bypass_held_out_release():
    data = build()
    data['partition'] = 'held_out'
    for case in data['cases']: case['provenance']['kind'] = 'external'
    with pytest.raises(ValueError, match='custodian'):
        manifest('validation_cases', data, agent_configuration_id='synthetic-test',
                 captured_at='2026-10-21T12:00:00+00:00', limitations=[])
