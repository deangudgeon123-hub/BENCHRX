"""Versioned, partition-aware validation with explicit evidence availability."""
import hashlib
import json
from pathlib import Path

from benchmarks.evaluator import evaluate_text, interpret_semantic, SEMANTIC_KINDS
from benchmarks.policy import EVALUATOR_VERSION

PARTITIONS = {'development', 'calibration', 'held_out'}
STATES = {'PASS', 'FAIL', 'INDETERMINATE', 'INFRA_ERROR', 'EVIDENCE_UNAVAILABLE'}
SCHEMA = 'validation-dataset-v1'
ROOT = Path(__file__).resolve().parents[1]


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def evaluator_fingerprint():
    return canonical_hash({p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
                           for p in ('benchmarks/evaluator.py', 'benchmarks/tests.py', 'benchmarks/policy.py', 'validation/datasets.py')})


def validate(dataset):
    if dataset.get('schema') != SCHEMA or not isinstance(dataset.get('version'), str) or not dataset['version'].strip():
        raise ValueError('Dataset schema/version required')
    if dataset.get('partition') not in PARTITIONS or not isinstance(dataset.get('cases'), list) or not dataset['cases']:
        raise ValueError('A nonempty named partition is required')
    ids = set()
    for case in dataset['cases']:
        for field in ('id', 'group_id', 'agent_type', 'scenario'):
            if not isinstance(case.get(field), str) or not case[field].strip():
                raise ValueError(f'Missing {field}')
        if case['id'] in ids:
            raise ValueError('Duplicate case ID')
        ids.add(case['id'])
        provenance = case.get('provenance', {})
        if (provenance.get('kind') not in {'synthetic_development', 'external'}
                or not all(isinstance(provenance.get(k), str) and provenance[k].strip()
                           for k in ('source', 'collected_at', 'permission'))):
            raise ValueError('Explicit provenance and permitted-use record required')
        if dataset['partition'] == 'held_out' and provenance['kind'] != 'external':
            raise ValueError('Synthetic development data cannot establish held-out validation')
        contract = case.get('contract', {})
        if not all(contract.get(k) for k in ('key', 'kind', 'description')):
            raise ValueError('Full contract required')
        if not (isinstance(contract.get('message'), str) or (isinstance(contract.get('messages'), list) and all(isinstance(m, str) for m in contract['messages']))):
            raise ValueError('Contract prompt(s) required')
        if contract['kind'] not in SEMANTIC_KINDS | {'normal', 'exact', 'json_exact', 'bounded', 'repeatability', 'paired_exact'}:
            raise ValueError('Unsupported offline contract kind')
        if contract['kind'] in {'exact', 'json_exact', 'repeatability', 'paired_exact'} and 'expected' not in contract:
            raise ValueError('Expected output required by contract')
        if contract['kind'] == 'bounded' and (not contract.get('required') or not isinstance(contract.get('max_words'), int) or contract['max_words'] < 1):
            raise ValueError('Bounded contract requires tokens and positive word limit')
        evidence = case.get('evidence', {})
        if evidence.get('status') not in {'observed', 'infra_error', 'unavailable'}:
            raise ValueError('Evidence availability required')
        if evidence['status'] == 'observed':
            if contract['kind'] in {'repeatability', 'paired_exact'}:
                responses = evidence.get('responses')
                if not isinstance(responses, list) or len(responses) < 2 or not all(isinstance(r, str) for r in responses):
                    raise ValueError('Repeated contracts require at least two observed responses')
                if contract['kind'] == 'paired_exact' and len(responses) != len(contract.get('messages', [])):
                    raise ValueError('Paired contract requires one response per prompt')
            elif not isinstance(evidence.get('response'), str):
                raise ValueError('Observed text response required; missing is not an empty answer')
        elif not isinstance(evidence.get('reason'), str) or not evidence['reason'].strip():
            raise ValueError('Unavailable/infra evidence requires explanation')
        label = case.get('reference', {})
        if label.get('verdict') not in STATES or not all(isinstance(label.get(k), str) and label[k].strip()
                                                       for k in ('rationale', 'labeler_id', 'labelled_at')):
            raise ValueError('Reference label and provenance required')
        if type(label.get('independent_human')) is not bool:
            raise ValueError('Reference independence must be explicitly declared')
        if provenance['kind'] == 'synthetic_development' and label['independent_human']:
            raise ValueError('Synthetic generated labels cannot claim independent human review')
    return dataset


def evaluate_case(case):
    evidence = case['evidence']
    if evidence['status'] == 'infra_error':
        return {'verdict': 'INFRA_ERROR', 'reason': evidence['reason']}
    if evidence['status'] == 'unavailable':
        return {'verdict': 'EVIDENCE_UNAVAILABLE', 'reason': evidence['reason']}
    contract = case['contract']
    if contract['kind'] in {'repeatability', 'paired_exact'}:
        passed = all(evaluate_text(contract, text) for text in evidence['responses'])
        return {'verdict': 'PASS' if passed else 'FAIL', 'reason': 'All observed repetitions must satisfy the output contract.'}
    text = evidence['response']
    if contract['kind'] in SEMANTIC_KINDS:
        return interpret_semantic(contract, text)
    return {'verdict': 'PASS' if evaluate_text(contract, text) else 'FAIL',
            'reason': 'Versioned deterministic output contract.'}


def register(partition_files):
    """Custodian-only sealing; developers should not inspect held-out payloads."""
    partitions, groups, ids, evidence_hashes = {}, {}, set(), {}
    for path in partition_files:
        raw = Path(path).read_bytes()
        data = validate(json.loads(raw))
        name = data['partition']
        if name in partitions:
            raise ValueError('One file per partition required')
        for case in data['cases']:
            if case['id'] in ids:
                raise ValueError('Case ID reused across partitions')
            ids.add(case['id'])
            group = canonical_hash(case['group_id'])
            # Exact observation duplicates are barred even if an author changes group IDs.
            evidence_hash = canonical_hash({'contract': case['contract'], 'evidence': case['evidence']})
            for key, table in ((group, groups), (evidence_hash, evidence_hashes)):
                if key in table and table[key] != name:
                    raise ValueError('Related or duplicate evidence leaked across partitions')
                table[key] = name
        partitions[name] = {'sha256': hashlib.sha256(raw).hexdigest(), 'count': len(data['cases']),
                            'version': data['version']}
    return {'schema': 'validation-partitions-v1', 'partitions': partitions,
            'group_partition_commitments': groups, 'evidence_partition_commitments': evidence_hashes,
            'evaluator_version': EVALUATOR_VERSION, 'evaluator_fingerprint': evaluator_fingerprint(),
            'held_out_status': 'SEALED_PENDING_EXTERNAL_REVIEW' if 'held_out' in partitions else 'PENDING_EXTERNAL_DATA'}


def assess_dataset(path, manifest, *, release_held_out=False):
    raw = Path(path).read_bytes()
    data = validate(json.loads(raw))
    partition = data['partition']
    entry = manifest['partitions'].get(partition)
    if not entry or entry['sha256'] != hashlib.sha256(raw).hexdigest():
        raise ValueError('Dataset bytes differ from sealed manifest')
    if partition == 'held_out':
        if not release_held_out or manifest['evaluator_fingerprint'] != evaluator_fingerprint():
            raise ValueError('Held-out evaluation requires explicit release under frozen evaluator code')
    rows = [{'id': c['id'], 'group_id': c['group_id'], 'agent_type': c['agent_type'],
             'scenario': c['scenario'], 'reference': c['reference'], 'prediction': evaluate_case(c)} for c in data['cases']]
    def summarize(selected):
        matrix = {r: {p: 0 for p in sorted(STATES)} for r in sorted(STATES)}
        for row in selected:
            matrix[row['reference']['verdict']][row['prediction']['verdict']] += 1
        return {'n': len(selected), 'matrix_reference_rows_prediction_columns': matrix,
                'matched': sum(matrix[v][v] for v in STATES),
                'false_pass': sum(matrix[v]['PASS'] for v in STATES if v != 'PASS')}
    return {'schema': 'validation-analysis-v1', 'partition': partition, 'dataset_version': data['version'],
            'dataset_sha256': entry['sha256'], 'evaluator_version': EVALUATOR_VERSION,
            'evaluator_fingerprint': evaluator_fingerprint(), 'independent_validation': False,
            'limitation': 'Reference independence is self-reported. Repeated/generated cases are correlated, not independent samples. No population accuracy or confidence claimed.',
            'summary': summarize(rows), 'by_scenario': {s: summarize([r for r in rows if r['scenario'] == s]) for s in sorted({r['scenario'] for r in rows})},
            'by_agent_type': {s: summarize([r for r in rows if r['agent_type'] == s]) for s in sorted({r['agent_type'] for r in rows})},
            'rows': rows}
