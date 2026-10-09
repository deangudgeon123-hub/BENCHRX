"""Offline, synthetic contract calibration. Never invokes a deployed agent or judge."""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'worker'))

import httpx
from benchmarks import evaluator
from benchmarks.policy import EVALUATOR_VERSION, SCORING_POLICY_VERSION
from benchmarks.tests import BENCHMARK_SUITE_VERSION, TESTS

FIXTURE = ROOT / 'tests/fixtures/evaluator-calibration-v1.json'
ENDPOINT = 'https://evaluator-calibration.invalid'
LABELS = ('PASS', 'FAIL', 'INDETERMINATE', 'UNOBSERVED')
PLANNED = {test['key']: test for test in TESTS if test['category'] != 'error_handling'}


def expected_result(case: dict) -> dict:
    label = case['label']
    passed = True if label == 'PASS' else False if label == 'FAIL' else None
    return {'verdict': label, 'passed': passed,
            'score': 100 if passed is True else 0 if passed is False else None,
            'observed': label != 'UNOBSERVED',
            'evidence_complete': case.get('evidence_complete', label in {'PASS', 'FAIL'})}


def load_fixture(path: Path = FIXTURE) -> tuple[dict, str]:
    data = path.read_bytes()
    fixture = json.loads(data)
    if fixture.get('schema_version') != 'evaluator-calibration-v1':
        raise ValueError('Unsupported calibration schema')
    contracts_hash = hashlib.sha256(json.dumps(TESTS, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if (fixture.get('suite_version') != BENCHMARK_SUITE_VERSION
            or fixture.get('contracts_sha256') != contracts_hash):
        raise ValueError('Benchmark contracts changed; review labels before updating the fixture')
    if fixture.get('label_provenance') != 'synthetic_contract_labels' or fixture.get('independent_review') is not False:
        raise ValueError('This fixture must not claim independent validation')
    ids = set()
    covered = {label: set() for label in LABELS}
    for case in fixture['cases']:
        if not isinstance(case.get('id'), str) or not case['id'] or case['id'] in ids:
            raise ValueError('Calibration case IDs must be nonempty and unique')
        ids.add(case['id'])
        key, label = case.get('test_key'), case.get('label')
        if key not in PLANNED or label not in LABELS or not case.get('rationale'):
            raise ValueError('Each case needs a scored contract, reference label, and rationale')
        covered[label].add(key)
        if 'evidence_complete' in case and type(case['evidence_complete']) is not bool:
            raise ValueError('Evidence completeness must be a Boolean')
        if label in {'INDETERMINATE', 'UNOBSERVED'} and case.get('evidence_complete', False):
            raise ValueError('Unknown verdicts cannot claim complete evidence')
        if ('response' in case) == ('attempts' in case):
            raise ValueError('Specify either a response or explicit attempts, not both')
        if 'response' in case and not isinstance(case['response'], str):
            raise ValueError('Synthetic response must be text')
        if 'attempts' in case:
            test = PLANNED[key]
            count = 2 if test['kind'] == 'repeatability' else len(test['messages']) if test['kind'] == 'paired_exact' else 1
            if not isinstance(case['attempts'], list) or len(case['attempts']) != count:
                raise ValueError('Fixture attempts must match the real test plan')
            for attempt in case['attempts']:
                if attempt.get('error') == 'ReadTimeout' and set(attempt) == {'error'}:
                    continue
                if (set(attempt) != {'status', 'body'} or type(attempt['status']) is not int
                        or not 100 <= attempt['status'] <= 599 or not isinstance(attempt['body'], dict)):
                    raise ValueError('Attempt must be a mocked HTTP response or local ReadTimeout')
    if any(covered[label] != set(PLANNED) for label in ('PASS', 'FAIL')):
        raise ValueError('Every scored contract needs both a pass and a fail reference')
    semantic_keys = {key for key, test in PLANNED.items() if test['kind'] in evaluator.SEMANTIC_KINDS}
    if not semantic_keys <= covered['INDETERMINATE']:
        raise ValueError('Every semantic contract needs an inconclusive reference')
    return fixture, hashlib.sha256(data).hexdigest()


async def evaluate_case(case: dict) -> dict:
    test = PLANNED[case['test_key']]
    count = 2 if test['kind'] == 'repeatability' else len(test['messages']) if test['kind'] == 'paired_exact' else 1
    replies = case.get('attempts', [{'status': 200, 'body': {'response': case.get('response')}}] * count)
    requests = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        # Even when local credentials exist, this path cannot forward them.
        if str(request.url) != ENDPOINT or request.method != 'POST' or 'authorization' in request.headers:
            raise AssertionError('Calibration must only use the isolated mock endpoint')
        attempt = replies[requests]
        requests += 1
        if 'error' in attempt:
            raise httpx.ReadTimeout('Synthetic calibration timeout', request=request)
        return httpx.Response(attempt['status'], json=attempt['body'])

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond), trust_env=False) as client:
        result = await evaluator.run_test(client, ENDPOINT, test)
    if requests != count:
        raise AssertionError('Calibration did not execute the complete real test plan')
    passed = result['passed']
    label = ('PASS' if passed is True else 'FAIL' if passed is False
             else 'INDETERMINATE' if result['observed'] else 'UNOBSERVED')
    actual = {key: result[key] for key in ('passed', 'score', 'observed', 'evidence_complete')}
    actual['verdict'] = label
    expected = expected_result(case)
    return {'id': case['id'], 'test_key': test['key'], 'category': test['category'],
            'expected': expected, 'actual': actual,
            'mismatched_fields': [key for key, value in expected.items()
                                  if type(actual[key]) is not type(value) or actual[key] != value]}


def summarize(rows: list[dict]) -> dict:
    confusion = {label: dict.fromkeys(LABELS, 0) for label in LABELS}
    for row in rows:
        confusion[row['expected']['verdict']][row['actual']['verdict']] += 1
    false_passes = sum(row['actual']['verdict'] == 'PASS' and row['expected']['verdict'] != 'PASS' for row in rows)
    false_failures = sum(row['actual']['verdict'] == 'FAIL' and row['expected']['verdict'] != 'FAIL' for row in rows)
    lost_verdicts = sum(row['expected']['verdict'] in {'PASS', 'FAIL'}
                        and row['actual']['verdict'] in {'INDETERMINATE', 'UNOBSERVED'} for row in rows)
    return {'case_count': len(rows), 'matched_cases': sum(not row['mismatched_fields'] for row in rows),
            'mismatch_count': sum(bool(row['mismatched_fields']) for row in rows),
            'false_passes': false_passes, 'false_failures': false_failures,
            'lost_conclusive_verdicts': lost_verdicts,
            'observation_or_score_mismatches': sum(any(key != 'verdict' for key in row['mismatched_fields']) for row in rows),
            'reference_label_counts': dict(Counter(row['expected']['verdict'] for row in rows)),
            'confusion_matrix': confusion}


async def calibrate(path: Path = FIXTURE) -> dict:
    fixture, digest = load_fixture(path)
    rows = [await evaluate_case(case) for case in fixture['cases']]
    return {'schema_version': fixture['schema_version'], 'fixture_sha256': digest,
            'contracts_sha256': fixture['contracts_sha256'], 'suite_version': BENCHMARK_SUITE_VERSION,
            'evaluator_version': EVALUATOR_VERSION, 'semantic_interpreter_version': evaluator.SEMANTIC_INTERPRETER_VERSION,
            'scoring_policy_version': SCORING_POLICY_VERSION,
            'label_provenance': fixture['label_provenance'], 'independent_review': False,
            'limitation': 'Synthetic regression agreement is not real-world accuracy or independent validation.',
            'summary': summarize(rows),
            'by_category': {category: summarize([row for row in rows if row['category'] == category])
                            for category in sorted({row['category'] for row in rows})},
            'cases': rows}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', action='store_true', help='Emit a versioned structural report without response bodies')
    args = parser.parse_args()
    report = asyncio.run(calibrate())
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        summary = report['summary']
        print(f"Synthetic calibration: {summary['matched_cases']}/{summary['case_count']} cases match reference labels")
        print(f"False passes: {summary['false_passes']}; false failures: {summary['false_failures']}; lost verdicts: {summary['lost_conclusive_verdicts']}")
        print(f"Evaluator: {report['evaluator_version']}; fixture SHA-256: {report['fixture_sha256']}")
        for row in report['cases']:
            if row['mismatched_fields']:
                print(f"MISMATCH {row['id']}: expected {row['expected']}, actual {row['actual']}")
        print(report['limitation'])
    return 1 if report['summary']['mismatch_count'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
