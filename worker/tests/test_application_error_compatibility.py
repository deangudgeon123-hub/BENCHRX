"""Offline adapter/worker boundary checks; no deployed agent calls."""
import json
from pathlib import Path
import httpx
import pytest
from benchmarks.evaluator import run_test
from benchmarks.tests import TESTS
from benchmarks.policy import assess

MATRIX = json.loads((Path(__file__).resolve().parents[2] / 'tests/fixtures/application-error-compatibility.json').read_text())


@pytest.mark.asyncio
@pytest.mark.parametrize('fixture', [c for c in MATRIX['cases'] if c['application_error']], ids=lambda c: c['id'])
async def test_adapter_error_reply_supplies_no_behavioural_score(fixture):
    # The TypeScript matrix proves that these completed outputs map to this
    # BENCHRX-created adapter rejection. Do not trust the "404" in remote text.
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(
        502, json={'error': 'Upstream application returned error-only output',
                   'diagnostics': {'stage': 'output', 'code': 'application_error_output'},
                   'response': fixture['output']}  # even body text cannot promote trusted failure
    )), trust_env=False) as client:
        results = []
        for test in TESTS:
            result = await run_test(client, 'https://offline.fixture.example', test)
            if test['category'] != 'error_handling':
                assert result['observed'] is False
                assert result['evidence_complete'] is False
                assert result['passed'] is None
                assert result['score'] is None
            results.append({**test, **result})
    assessment = assess(results)
    assert assessment['production_score'] is None
    assert assessment['readiness_status'] == 'insufficient_evidence'
    assert all(value['observed'] == 0 for value in assessment['coverage'].values())
