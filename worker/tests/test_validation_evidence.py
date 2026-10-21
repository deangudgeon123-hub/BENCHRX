import copy
import json
from pathlib import Path
import sys
import pytest
from benchmarks.tests import TESTS
from validation import evidence as ev
from validation.datasets import canonical_hash
from validation.workflows import CRMEnvironment
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from generate_validation_development import build


def export(kind, payload, **kwargs):
    return ev.manifest(kind, payload, agent_configuration_id='synthetic-test-driver',
                       captured_at='2026-10-21T12:00:00+00:00', limitations=['Software test fixture only.'], **kwargs)


def score_payload():
    return {'versions': {k: ev.rules()[k] for k in ('evaluator_version', 'scoring_policy_version', 'benchmark_suite_version')},
            'results': [dict(key=t['key'], category=t['category'], weight=t['weight'], passed=True,
                             observed=True, evidence_complete=True, score=100) for t in TESTS]}


def test_saved_case_replay_deterministic():
    saved = export('validation_cases', build())
    assert ev.replay(saved) == ev.replay(json.loads(json.dumps(saved)))
    assert saved['independent_validation'] is False


def test_workflow_replay_with_failure_and_recovery():
    env = CRMEnvironment('recover')
    env.call('read', {'customer_id': 'c001'})
    args = {'customer_id': 'c001', 'email': 'alex.new@example.invalid', 'expected_version': 1}
    env.call('update_email', args)
    env.call('update_email', args)
    env.call('verify', {'customer_id': 'c001', 'expected_version': 2})
    saved = export('crm_workflow', env.finish('Done'))
    assert ev.replay(saved)['result']['operational_verdict'] == 'PASS'


@pytest.mark.parametrize('mutation', ['payload', 'result', 'rules'])
def test_tampering_rejected(mutation):
    saved = export('validation_cases', build())
    saved[mutation]['tampered'] = True
    with pytest.raises(ValueError, match='integrity'): ev.replay(saved)


def test_tampered_workflow_outcome_detected_even_after_hashing():
    data = CRMEnvironment('update').finish('Done')
    data['operational_verdict'] = 'PASS'
    data.pop('evidence_sha256')
    data['evidence_sha256'] = canonical_hash(data)
    with pytest.raises(ValueError, match='replay mismatch'): export('crm_workflow', data)


def test_changed_source_rules_refuse_replay(monkeypatch):
    saved = export('validation_cases', build())
    monkeypatch.setattr(ev, 'rules', lambda: {'evaluator_version': 'different'})
    with pytest.raises(ValueError, match='Rules differ'): ev.replay(saved)


def test_revision_preserves_original_and_link():
    payload = build()
    before = export('validation_cases', payload)
    original = copy.deepcopy(before)
    payload['cases'][0]['evidence'] = {'status': 'unavailable', 'reason': 'permission withdrawn for response retention'}
    after = export('validation_cases', payload, parent=before, correction_reason='Evidence permission changed')
    assert before == original
    assert after['revision']['previous_manifest_sha256'] == before['manifest_sha256']
    assert before['manifest_sha256'] != after['manifest_sha256']
    assert ev.replay(after)['reproduced']


def test_revision_requires_reason():
    before = export('validation_cases', build())
    with pytest.raises(ValueError, match='reason'): export('validation_cases', build(), parent=before)


def test_saved_scores_replay_without_mutation():
    payload = score_payload()
    before = copy.deepcopy(payload)
    saved = export('saved_score_rows', payload)
    assert ev.replay(saved)['result']['production_score'] == 100
    assert payload == before
    assert any('arithmetic' in s for s in saved['limitations'])


def test_historical_version_not_silently_relabelled():
    payload = score_payload()
    payload['versions']['evaluator_version'] = 'deterministic-v2.20'
    with pytest.raises(ValueError, match='Historical'): export('saved_score_rows', payload)


def test_missing_evidence_cannot_be_exported_as_pass():
    payload = score_payload()
    payload['results'][0]['evidence_complete'] = False
    with pytest.raises(ValueError, match='Missing evidence'): export('saved_score_rows', payload)


def test_modified_weights_rejected():
    payload = score_payload()
    payload['results'][0]['weight'] = 999
    with pytest.raises(ValueError, match='weight'): export('saved_score_rows', payload)


def test_safety_failure_blocks_positive_readiness():
    payload = score_payload()
    row = next(r for r in payload['results'] if r['category'] == 'safety')
    row.update(passed=False, score=0)
    assert export('saved_score_rows', payload)['result']['readiness_status'] == 'blocked_safety'


def test_diagnostic_rejection_is_not_behavioural_observation():
    payload = score_payload()
    for row in payload['results']:
        if row['category'] == 'error_handling': row['observed'] = False
    assert export('saved_score_rows', payload)['result']['production_score'] == 100
