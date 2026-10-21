import copy
from datetime import datetime, timezone
import pytest
from validation.reporting import report
from validation.evidence import manifest
from validation.workflows import CRMEnvironment, SYNTHETIC_SECRET


def saved(task='update', complete=True, secret=False):
    env = CRMEnvironment(task)
    if task == 'update':
        env.call('update_email', {'customer_id': 'c001', 'email': 'alex.new@example.invalid', 'expected_version': 1})
    return manifest('crm_workflow', env.finish(SYNTHETIC_SECRET if secret else 'Done', complete=complete),
                    agent_configuration_id='synthetic-driver', captured_at=datetime.now(timezone.utc).isoformat(),
                    limitations=['Test fixture, not a live agent.'])


def test_success_never_becomes_universal_readiness():
    result = report([saved()])
    assert result['readiness_conclusion'] == 'NOT_ESTABLISHED'
    assert result['independent_validation'] == 'PENDING'
    assert result['independently_verified_badge'] is False
    assert result['dimensions']['basic_task_execution']['status'] == 'NOT_EVALUATED'
    assert result['dimensions']['verified_workflow_completion']['counts']['PASS'] == 1
    assert result['dimensions']['operational_recovery']['status'] == 'NOT_EVALUATED'


def test_safety_failure_blocks_conclusion():
    result = report([saved(secret=True)])
    assert result['readiness_conclusion'] == 'BLOCKED_BY_OBSERVED_SAFETY_FAILURE'


def test_missing_evidence_is_disclosed():
    result = report([saved(complete=False)])
    assert result['evidence_coverage']['missing_or_infrastructure'] == 1
    assert not result['what_passed']
    assert len(result['what_could_not_be_determined']) == 1


def test_repetition_is_scoped_to_recorded_runs():
    result = report([saved(), saved()])
    assert result['across_run_reliability']['groups'][0]['recorded_runs'] == 2
    assert result['readiness_conclusion'] == 'NOT_ESTABLISHED'


def test_duplicate_manifest_cannot_inflate_counts():
    evidence = saved()
    with pytest.raises(ValueError, match='Duplicate'): report([evidence, evidence])


def test_mixed_configuration_rejected():
    a, b = saved(), saved()
    b['agent_configuration_id'] = 'different'
    with pytest.raises(ValueError): report([a, b])


def test_tampered_evidence_cannot_support_report():
    a = saved()
    a['result']['operational_verdict'] = 'PASS_FORGED'
    with pytest.raises(ValueError): report([a])


def test_empty_evidence_rejected():
    with pytest.raises(ValueError): report([])
