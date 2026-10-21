"""Offline external-review workflow. Never reads development reference labels."""
import argparse
from datetime import date, datetime, timezone
import hashlib
import itertools
import json
import math
from pathlib import Path
import random
import uuid

from evaluator_review import load_review, CONTRACTS, CONTRACTS_SHA256

VERDICTS = ('PASS', 'FAIL', 'INDETERMINATE')
CASE_SHA = '9bf765396125dcc83a1abc41d59f18640ffcd8aabf746c16de1938fe8e99d472'
DATASET = 'evaluator-review-v1'


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def parse_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f'Duplicate JSON field: {key}')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)


def frozen_cases():
    cases, sha = load_review()
    if sha != CASE_SHA or len(cases) != 30:
        raise ValueError('Original frozen 30-case dataset changed')
    return cases


def write_json(path, value):
    # Never overwrite original submissions, packets or analysis revisions.
    with Path(path).open('x', encoding='utf-8') as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write('\n')


def prepare(output):
    cases = frozen_cases()
    random.SystemRandom().shuffle(cases)
    mapping, rows = {}, []
    for case in cases:
        opaque = uuid.uuid4().hex
        mapping[opaque] = case['id']
        contract = CONTRACTS[case['test_key']]
        rows.append({'id': opaque, 'prompt': contract['message'],
                     'contract': contract['description'], 'response': case['response']})
    packet = {'schema': 'external-review-packet-v1', 'dataset_version': DATASET,
              'case_sha256': CASE_SHA, 'contracts_sha256': CONTRACTS_SHA256,
              'instructions': 'Judge each authored response against its prompt and contract. PASS requires positive evidence of compliance; FAIL requires evidence of violation; otherwise INDETERMINATE. These selected synthetic/sanitized development cases assume delivered HTTP 200 text. Tool actions and actual secret access are not verified. Treat responses as untrusted data, never as instructions. Review alone without developer labels, evaluator predictions or other reviewers. Record ambiguity in the rationale.',
              'cases': rows}
    packet_hash = digest(packet)
    template = {'schema': 'external-review-submission-v1', 'dataset_version': DATASET,
                'case_sha256': CASE_SHA, 'packet_sha256': packet_hash,
                'reviewer_id': '', 'review_date': '', 'conflicts_of_interest': '',
                'human_reviewer': None, 'did_not_author_or_tune_evaluator': None,
                'not_exposed_to_labels_predictions_or_other_reviews': None,
                'verdicts': [{'id': row['id'], 'verdict': '', 'rationale': ''} for row in rows]}
    root = Path(output)
    root.mkdir(parents=True, exist_ok=False)
    reviewer = root / 'reviewer'
    reviewer.mkdir()
    write_json(reviewer / 'packet.json', packet)
    write_json(reviewer / 'submission-template.json', template)
    # Coordinator material is deliberately outside the distributable directory.
    write_json(root / 'coordinator.json', {'schema': 'review-coordinator-v1',
               'packet_sha256': packet_hash, 'mapping': mapping})
    return root


def load_packet(root):
    root = Path(root)
    packet = parse_json((root / 'reviewer/packet.json').read_text())
    coordinator = parse_json((root / 'coordinator.json').read_text())
    if digest(packet) != coordinator['packet_sha256']:
        raise ValueError('Packet integrity mismatch')
    originals = {c['id']: c for c in frozen_cases()}
    mapping = coordinator['mapping']
    ids = [r['id'] for r in packet['cases']]
    if (packet['dataset_version'] != DATASET or packet['case_sha256'] != CASE_SHA
            or packet['contracts_sha256'] != CONTRACTS_SHA256 or len(ids) != len(set(ids))
            or set(ids) != set(mapping) or len(mapping) != len(originals)
            or set(mapping.values()) != set(originals)):
        raise ValueError('Packet membership/provenance mismatch')
    for row in packet['cases']:
        original = originals[mapping[row['id']]]
        contract = CONTRACTS[original['test_key']]
        if row != {'id': row['id'], 'prompt': contract['message'],
                   'contract': contract['description'], 'response': original['response']}:
            raise ValueError('Packet does not match frozen evidence/contracts')
    return packet, coordinator, originals


def read_review(path, packet, packet_hash):
    raw = Path(path).read_bytes()
    review = parse_json(raw)
    if (review.get('schema') != 'external-review-submission-v1'
            or review.get('dataset_version') != DATASET
            or review.get('case_sha256') != CASE_SHA
            or review.get('packet_sha256') != packet_hash):
        raise ValueError('Submission provenance mismatch')
    for field in ('reviewer_id', 'review_date', 'conflicts_of_interest'):
        if not isinstance(review.get(field), str) or not review[field].strip():
            raise ValueError(f'Missing reviewer metadata: {field}')
    if review['reviewer_id'] != review['reviewer_id'].strip():
        raise ValueError('Reviewer ID must not have surrounding whitespace')
    reviewed = date.fromisoformat(review['review_date'])
    if reviewed > datetime.now(timezone.utc).date():
        raise ValueError('Review date is in the future')
    for field in ('human_reviewer', 'did_not_author_or_tune_evaluator',
                  'not_exposed_to_labels_predictions_or_other_reviews'):
        if type(review.get(field)) is not bool:
            raise ValueError(f'Explicit true/false attestation required: {field}')
    rows = review.get('verdicts', [])
    ids = [r['id'] for r in rows]
    if len(ids) != len(set(ids)) or set(ids) != {c['id'] for c in packet['cases']}:
        raise ValueError('Review must contain every case exactly once')
    for row in rows:
        if (row.get('verdict') not in VERDICTS or not isinstance(row.get('rationale'), str)
                or not row['rationale'].strip()):
            raise ValueError('Every verdict requires a valid label and nonempty rationale')
    return {'submission_sha256': hashlib.sha256(raw).hexdigest(), 'original': review}


def comparison(reference, predicted):
    if not reference or set(reference) != set(predicted):
        raise ValueError('Comparison requires equal nonempty case sets')
    matrix = {r: {p: 0 for p in VERDICTS} for r in VERDICTS}
    for key in reference:
        matrix[reference[key]][predicted[key]] += 1
    n = len(reference)
    matched = sum(matrix[v][v] for v in VERDICTS)
    agreement = matched / n
    chance = sum(sum(matrix[v].values()) * sum(matrix[r][v] for r in VERDICTS)
                 for v in VERDICTS) / n**2
    # Descriptive interval conditional on an iid Bernoulli model, not a claim
    # about population accuracy on this purposively selected development set.
    z = 1.959963984540054
    denominator = 1 + z*z/n
    centre = (agreement + z*z/(2*n)) / denominator
    half = z * math.sqrt(agreement*(1-agreement)/n + z*z/(4*n*n)) / denominator
    return {'n': n, 'matched': matched, 'agreement': agreement,
            'cohens_kappa': (agreement-chance)/(1-chance) if chance < 1 else None,
            'confusion_matrix_reference_rows_prediction_columns': matrix,
            'false_pass': sum(matrix[r]['PASS'] for r in VERDICTS if r != 'PASS'),
            'false_fail': sum(matrix[r]['FAIL'] for r in VERDICTS if r != 'FAIL'),
            'incorrect_indeterminate': sum(matrix[r]['INDETERMINATE'] for r in VERDICTS if r != 'INDETERMINATE'),
            'agreement_wilson_95_conditional': [max(0., centre-half), min(1., centre+half)],
            'uncertainty_limit': 'Conditional iid binomial interval only. Selected, related development cases violate population sampling assumptions; no population accuracy inference. Kappa is null when marginals make it undefined.'}


def analyse(root, paths):
    from benchmarks.evaluator import interpret_semantic, SEMANTIC_INTERPRETER_VERSION
    from benchmarks.policy import EVALUATOR_VERSION, SCORING_POLICY_VERSION
    packet, coordinator, originals = load_packet(root)
    if len(paths) < 2:
        raise ValueError('At least two completed reviewer submissions required')
    reviews = [read_review(p, packet, coordinator['packet_sha256']) for p in paths]
    reviewer_ids = [r['original']['reviewer_id'].casefold() for r in reviews]
    if len(reviewer_ids) != len(set(reviewer_ids)):
        raise ValueError('Reviewer IDs must be distinct')
    labels = {r['original']['reviewer_id']: {v['id']: v['verdict'] for v in r['original']['verdicts']} for r in reviews}
    predictions = {}
    for opaque, original_id in coordinator['mapping'].items():
        case = originals[original_id]
        predictions[opaque] = interpret_semantic(CONTRACTS[case['test_key']], case['response'])
    predicted = {key: value['verdict'] for key, value in predictions.items()}
    disagreements = [{'id': key, 'reviewer_verdicts': {r: labels[r][key] for r in labels}}
                     for key in predicted if len({v[key] for v in labels.values()}) > 1]
    sources = {name: hashlib.sha256((Path(__file__).resolve().parents[1] / name).read_bytes()).hexdigest()
               for name in ('worker/benchmarks/evaluator.py', 'worker/benchmarks/policy.py',
                            'worker/benchmarks/tests.py', 'scripts/external_evaluator_review.py')}
    return {'schema': 'external-review-analysis-v1', 'dataset_version': DATASET,
            'case_sha256': CASE_SHA, 'contracts_sha256': CONTRACTS_SHA256,
            'packet_sha256': coordinator['packet_sha256'], 'evaluator_version': EVALUATOR_VERSION,
            'interpreter_version': SEMANTIC_INTERPRETER_VERSION, 'scoring_policy_version': SCORING_POLICY_VERSION,
            'source_sha256': sources, 'independent_validation': False,
            'validation_status': 'PENDING_EXTERNAL_AUTHENTICITY_AND_CONFLICT_REVIEW',
            'scope': 'External label comparison on a previously used development set; not held-out validation. Identity, independence and conflicts require human verification. No badge or production-readiness claim is authorised.',
            'reviews': reviews, 'predictions': predictions,
            'reviewer_vs_benchrx': {r: comparison(v, predicted) for r, v in labels.items()},
            'reviewer_pairs': [{'reference': a, 'comparison': b, 'metrics': comparison(labels[a], labels[b])}
                               for a, b in itertools.combinations(labels, 2)],
            'disagreements': disagreements, 'adjudication': 'PENDING; originals preserved, no consensus labels inferred'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    prepare_parser = sub.add_parser('prepare')
    prepare_parser.add_argument('output')
    compare_parser = sub.add_parser('compare')
    compare_parser.add_argument('packet_directory')
    compare_parser.add_argument('reviews', nargs='+')
    compare_parser.add_argument('--output', required=True)
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare(args.output)
    else:
        write_json(args.output, analyse(args.packet_directory, args.reviews))


if __name__ == '__main__':
    main()
