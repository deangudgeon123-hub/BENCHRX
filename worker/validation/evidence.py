"""Integrity-bound offline evidence replay. Hashes do not authenticate origin."""
import copy
from datetime import datetime, timezone
import hashlib
import math
import sys
from pathlib import Path

from benchmarks.policy import EVALUATOR_VERSION, SCORING_POLICY_VERSION, assess
from benchmarks.tests import BENCHMARK_SUITE_VERSION, TESTS
from validation.datasets import canonical_hash, validate, evaluate_case
from validation.workflows import CRMEnvironment, SUITE_VERSION

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 'evaluation-evidence-v1'


def rules():
    paths = ('benchmarks/evaluator.py', 'benchmarks/policy.py', 'benchmarks/scoring.py',
             'benchmarks/tests.py', 'validation/datasets.py', 'validation/workflows.py', 'validation/evidence.py')
    return {'evaluator_version': EVALUATOR_VERSION, 'scoring_policy_version': SCORING_POLICY_VERSION,
            'benchmark_suite_version': BENCHMARK_SUITE_VERSION, 'workflow_suite_version': SUITE_VERSION,
            'python_version': sys.version,
            'requirements_sha256': hashlib.sha256((ROOT / 'requirements.txt').read_bytes()).hexdigest(),
            'source_sha256': {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths}}


def replay_workflow(saved):
    data = copy.deepcopy(saved)
    claimed_hash = data.pop('evidence_sha256')
    if canonical_hash(data) != claimed_hash or data['suite_version'] != SUITE_VERSION:
        raise ValueError('Workflow evidence hash/version mismatch')
    env = CRMEnvironment(data['task_id'])
    for event in data['tool_events']:
        env.call(event['operation'], event['arguments'])
    rebuilt = env.finish(data['final_response'], complete=data['evidence_complete'])
    # Wall-clock capture time is metadata, not a nondeterministic scoring input.
    for key in data:
        if key != 'timestamp' and rebuilt.get(key) != data[key]:
            raise ValueError(f'Workflow replay mismatch: {key}')
    return {k: rebuilt[k] for k in ('operational_verdict', 'obligations', 'safety_violations', 'final_state')}


def replay_score(payload):
    # This replays arithmetic and gates from saved rows, NOT response extraction
    # or the behavioural evaluator that originally produced those rows.
    declared = payload.get('versions')
    expected = {k: rules()[k] for k in ('evaluator_version', 'scoring_policy_version', 'benchmark_suite_version')}
    if declared != expected:
        raise ValueError('Historical/unknown versions require their original checkout; never relabel them')
    contracts = {t['key']: t for t in TESTS}
    rows = payload['results']
    for row in rows:
        contract = contracts.get(row.get('key'))
        if not contract or row.get('category') != contract['category'] or row.get('weight') != contract['weight']:
            raise ValueError('Saved row does not match versioned contract/weight')
        if type(row.get('observed')) is not bool or type(row.get('evidence_complete')) is not bool:
            raise ValueError('Evidence state required')
        if row.get('passed') is not None and type(row['passed']) is not bool:
            raise ValueError('Invalid pass value')
        score = row.get('score')
        if score is not None and (type(score) not in (float, int) or not math.isfinite(score) or not 0 <= score <= 100):
            raise ValueError('Invalid score')
        if row.get('passed') is True and (not row['evidence_complete'] or (contract['category'] != 'error_handling' and not row['observed'])):
            raise ValueError('Missing evidence cannot support PASS')
    return assess(copy.deepcopy(rows))


def calculate(kind, payload):
    if kind == 'validation_cases':
        validate(payload)
        return {'case_verdicts': [{'id': c['id'], **evaluate_case(c)} for c in payload['cases']]}
    if kind == 'crm_workflow':
        return replay_workflow(payload)
    if kind == 'saved_score_rows':
        return replay_score(payload)
    raise ValueError('Unsupported evidence kind')


def manifest(kind, payload, *, agent_configuration_id, captured_at, limitations, parent=None, correction_reason=None):
    if not isinstance(agent_configuration_id, str) or not agent_configuration_id.strip():
        raise ValueError('Agent configuration identifier required; do not include credentials')
    timestamp = datetime.fromisoformat(captured_at)
    if timestamp.tzinfo is None:
        raise ValueError('Capture timestamp must include timezone')
    if not isinstance(limitations, list) or not all(isinstance(s, str) and s.strip() for s in limitations):
        raise ValueError('Limitations must be an explicit list')
    if parent is not None:
        verify(parent)
        if not isinstance(correction_reason, str) or not correction_reason.strip():
            raise ValueError('Correction reason required for revision')
    elif correction_reason is not None:
        raise ValueError('Correction must reference a prior manifest')
    payload = copy.deepcopy(payload)
    document = {'schema': SCHEMA, 'kind': kind, 'rules': rules(), 'agent_configuration_id': agent_configuration_id,
                'captured_at': captured_at, 'exported_at': datetime.now(timezone.utc).isoformat(),
                'payload': payload, 'payload_sha256': canonical_hash(payload), 'result': calculate(kind, payload),
                'limitations': limitations + ['Hashes detect changes relative to a trusted copy, not authenticity or independent validation.',
                                             'Offline replay is not live agent repeatability.'],
                'independent_validation': False,
                'revision': {'previous_manifest_sha256': parent['manifest_sha256'], 'reason': correction_reason} if parent else None}
    if kind == 'saved_score_rows':
        document['limitations'].append('Score arithmetic/gates only. Original response extraction and behavioural verdicts are not re-verified.')
    document['manifest_sha256'] = canonical_hash(document)
    return document


def verify(document):
    data = copy.deepcopy(document)
    claimed = data.pop('manifest_sha256')
    if data.get('schema') != SCHEMA or canonical_hash(data) != claimed:
        raise ValueError('Manifest integrity failure')
    if canonical_hash(data['payload']) != data['payload_sha256']:
        raise ValueError('Payload integrity failure')
    return data


def replay(document):
    data = verify(document)
    if data['rules'] != rules():
        raise ValueError('Rules differ: use the original source/dependency environment for replay')
    actual = calculate(data['kind'], data['payload'])
    if actual != data['result']:
        raise ValueError('Saved conclusion differs from replay')
    return {'reproduced': True, 'manifest_sha256': document['manifest_sha256'], 'result': actual,
            'scope': 'Saved permitted evidence under identical source rules; not live repeatability or independent accuracy.'}
