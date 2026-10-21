"""All reference labels here are software fixtures, not human review results."""
import copy
import json
from pathlib import Path
import sys
import pytest
from validation import datasets as ds
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from generate_validation_development import build


def save(tmp_path, data, name='cases.json'):
    path = tmp_path / name
    path.write_text(json.dumps(data))
    return path


def test_hundreds_of_cases_with_explicit_limits(tmp_path):
    data = build()
    path = save(tmp_path, data)
    report = ds.assess_dataset(path, ds.register([path]))
    assert report['summary']['n'] == 408
    assert len(report['by_scenario']) == 17
    assert len(report['by_agent_type']) == 3
    assert report['independent_validation'] is False
    assert {r['prediction']['verdict'] for r in report['rows']} == ds.STATES


@pytest.mark.parametrize('status,expected', [('infra_error', 'INFRA_ERROR'), ('unavailable', 'EVIDENCE_UNAVAILABLE')])
def test_missing_evidence_cannot_pass(status, expected):
    case = build()['cases'][0]
    case['evidence'] = {'status': status, 'reason': 'simulated', 'response': 'BENCHRX_TASK_OK'}
    assert ds.evaluate_case(case)['verdict'] == expected


def test_repeated_requires_every_response():
    case = next(c for c in build()['cases'] if c['scenario'] == 'repeated_task')
    assert ds.evaluate_case(case)['verdict'] == 'FAIL'


@pytest.mark.parametrize('mutation', ['missing_response', 'duplicate_id', 'no_provenance', 'no_contract', 'synthetic_independent', 'synthetic_held_out', 'missing_repeat'])
def test_validation_rejects_invalid_inputs(mutation):
    data = build()
    if mutation == 'missing_response': data['cases'][0]['evidence'].pop('response')
    if mutation == 'duplicate_id': data['cases'][1]['id'] = data['cases'][0]['id']
    if mutation == 'no_provenance': data['cases'][0]['provenance'] = {}
    if mutation == 'no_contract': data['cases'][0]['contract'] = {}
    if mutation == 'synthetic_independent': data['cases'][0]['reference']['independent_human'] = True
    if mutation == 'synthetic_held_out': data['partition'] = 'held_out'
    if mutation == 'missing_repeat':
        next(c for c in data['cases'] if c['scenario'] == 'repeated_task')['evidence']['responses'] = ['BENCHRX_REPEATABILITY_OK']
    with pytest.raises(ValueError): ds.validate(data)


def test_cross_partition_group_leak_rejected(tmp_path):
    data = build()
    other = copy.deepcopy(data)
    other['partition'] = 'calibration'
    for c in other['cases']: c['id'] += '-other'
    with pytest.raises(ValueError, match='leaked'):
        ds.register([save(tmp_path, data), save(tmp_path, other, 'calibration.json')])


def test_renamed_groups_cannot_hide_exact_duplicates(tmp_path):
    data = build()
    other = copy.deepcopy(data)
    other['partition'] = 'calibration'
    for c in other['cases']:
        c['id'] += '-other'
        c['group_id'] += '-other'
    with pytest.raises(ValueError, match='leaked'):
        ds.register([save(tmp_path, data), save(tmp_path, other, 'calibration.json')])


def test_sealed_bytes_cannot_change(tmp_path):
    data = build()
    path = save(tmp_path, data)
    manifest = ds.register([path])
    data['cases'][0]['reference']['verdict'] = 'FAIL'
    save(tmp_path, data)
    with pytest.raises(ValueError, match='sealed'): ds.assess_dataset(path, manifest)


def test_held_out_requires_release_and_frozen_evaluator(tmp_path, monkeypatch):
    # Simulated external provenance to exercise the gate, never validation evidence.
    data = build()
    data['partition'] = 'held_out'
    for c in data['cases']: c['provenance']['kind'] = 'external'
    path = save(tmp_path, data)
    manifest = ds.register([path])
    with pytest.raises(ValueError, match='release'): ds.assess_dataset(path, manifest)
    assert ds.assess_dataset(path, manifest, release_held_out=True)['independent_validation'] is False
    monkeypatch.setattr(ds, 'evaluator_fingerprint', lambda: 'changed')
    with pytest.raises(ValueError, match='frozen'): ds.assess_dataset(path, manifest, release_held_out=True)
