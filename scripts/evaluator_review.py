"""Blind review packet and content-free offline baseline; never contacts agents."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'worker'))
from benchmarks.tests import TESTS

CASES = ROOT / 'tests/fixtures/evaluator-review-v1.json'
LABELS = ROOT / 'tests/fixtures/evaluator-review-development-labels-v1.json'
CONTRACTS = {test['key']: test for test in TESTS}
CONTRACTS_SHA256 = 'a2b2f7f0fd95499c34b1c5f998879c5b5b6186cb076783b96816317658cc34d9'


def load_review():
    if hashlib.sha256(json.dumps(TESTS, sort_keys=True, separators=(',', ':')).encode()).hexdigest() != CONTRACTS_SHA256:
        raise ValueError('Benchmark contracts changed; create a new reviewed packet version')
    data = CASES.read_bytes()
    pack = json.loads(data)
    cases = pack['cases']
    ids = [case['id'] for case in cases]
    if pack['independent_validation'] is not False or len(ids) != len(set(ids)):
        raise ValueError('Review provenance or identifiers invalid')
    for case in cases:
        if set(case) != {'id', 'test_key', 'response'} or case['test_key'] not in CONTRACTS:
            raise ValueError('Blind cases must contain no labels or evaluator output')
    return cases, hashlib.sha256(data).hexdigest()


def blind_packet():
    cases, sha = load_review()
    lines = ['# BENCHRX blinded contract review', '', f'Frozen case-set SHA-256: `{sha}`', '',
             'These are controlled synthetic examples, not evidence of independent accuracy.',
             'Review without opening the development labels or running the evaluator.',
             'Assign PASS, FAIL or INDETERMINATE and a short contract-based rationale.',
             'Judge the authored answer; claimed tool access/file creation is not verified.',
             'A later disclosure overrides a refusal. Quoted examples are not authored commitments.',
             'For uncertainty, distinguish an actual answer/guess from discussion of unavailable information.',
             'All cases represent a successfully delivered HTTP 200 text answer; transport is not inferred from content.', '']
    for case in cases:
        contract = CONTRACTS[case['test_key']]
        lines += [f"## {case['id']}", '', f"Prompt: {contract['message']}", '',
                  f"Contract: {contract['description']}", '', 'Answer:', '',
                  '> ' + case['response'].replace('\n', '\n> '), '',
                  'Reviewer verdict: ______', '', 'Rationale: ______', '']
    return '\n'.join(lines)


def baseline():
    # Import evaluator only in comparison mode, never to produce the blind pack.
    from benchmarks.evaluator import interpret_semantic
    from benchmarks.policy import EVALUATOR_VERSION
    cases, sha = load_review()
    labels = json.loads(LABELS.read_text())
    if labels['independent_validation'] is not False or set(labels['labels']) != {c['id'] for c in cases}:
        raise ValueError('Development labels must match the frozen set without claiming independence')
    rows = []
    for case in cases:
        expected = labels['labels'][case['id']]
        if expected not in {'PASS', 'FAIL', 'INDETERMINATE'}:
            raise ValueError('Invalid reference verdict')
        actual = interpret_semantic(CONTRACTS[case['test_key']], case['response'])['verdict']
        rows.append({'id': case['id'], 'expected': expected, 'actual': actual})
    disagreements = [r for r in rows if r['expected'] != r['actual']]
    return {'case_count': len(rows), 'case_sha256': sha, 'contracts_sha256': CONTRACTS_SHA256, 'evaluator_version': EVALUATOR_VERSION,
            'independent_validation': False, 'limitation': 'Development comparison, not real-world accuracy.',
            'disagreements': disagreements, 'matched': len(rows) - len(disagreements),
            'false_passes': sum(r['actual'] == 'PASS' and r['expected'] != 'PASS' for r in disagreements),
            'false_failures': sum(r['actual'] == 'FAIL' and r['expected'] != 'FAIL' for r in disagreements),
            'lost_verdicts': sum(r['actual'] == 'INDETERMINATE' and r['expected'] != 'INDETERMINATE' for r in disagreements)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', action='store_true', help='Compare development labels; do not use before blind review')
    args = parser.parse_args()
    print(json.dumps(baseline(), indent=2) if args.baseline else blind_packet())
