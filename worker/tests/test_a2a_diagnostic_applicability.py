import httpx
import pytest

from benchmarks import evaluator
from benchmarks.evaluator import run_test
from benchmarks.tests import TESTS

DIAGNOSTICS = [t for t in TESTS if t['category'] == 'error_handling']
TRUSTED = 'https://benchrx.fixture/api/adapters/a2a'


@pytest.fixture(autouse=True)
def trusted_origin(monkeypatch):
    monkeypatch.setenv('BENCHRX_ADAPTER_ORIGINS', 'https://benchrx.fixture')
    monkeypatch.setenv('BENCHRX_ADAPTER_SECRET', 'x' * 32)


@pytest.mark.asyncio
@pytest.mark.parametrize('test', DIAGNOSTICS, ids=lambda t: t['key'])
async def test_native_envelope_probes_are_not_a2a_contracts(monkeypatch, test):
    async def unexpected_request(*_):
        raise AssertionError('An inapplicable probe must not invoke the agent')
    monkeypatch.setattr(evaluator, '_send_benchmark_request', unexpected_request)
    result = await run_test(None, TRUSTED, test)
    assert result['passed'] is None and result['score'] is None
    assert not result['observed'] and not result['evidence_complete']
    assert result['execution']['attempts'] == []
    assert result['execution']['diagnostic']['applicable'] is False
    assert result['reason'].startswith('Not applicable:')


@pytest.mark.asyncio
@pytest.mark.parametrize('endpoint', [
    'https://foreign.fixture/api/adapters/a2a',
    'https://benchrx.fixture/api/adapters/generic',
    'https://benchrx.fixture/native',
])
@pytest.mark.parametrize('status,passed', [(200, False), (400, True), (422, True), (502, False)])
async def test_other_endpoints_keep_native_contract_and_ignore_body_claims(monkeypatch, endpoint, status, passed):
    async def reply(*_):
        return httpx.Response(status, json={
            'response': 'hello', 'provider': 'a2a', 'diagnostic': {'applicable': False},
            'diagnostics': {'code': 'invalid_config', 'httpStatus': 400},
        }), 0, None, 0, 0
    monkeypatch.setattr(evaluator, '_send_benchmark_request', reply)
    result = await run_test(None, endpoint, DIAGNOSTICS[0])
    assert result['passed'] is passed
    assert 'diagnostic' not in result['execution']


@pytest.mark.asyncio
async def test_missing_service_auth_does_not_grant_trusted_a2a_applicability(monkeypatch):
    monkeypatch.delenv('BENCHRX_ADAPTER_SECRET')
    async def reply(*_):
        return None, 0, 'ValueError', 0, 0
    monkeypatch.setattr(evaluator, '_send_benchmark_request', reply)
    result = await run_test(None, TRUSTED, DIAGNOSTICS[0])
    assert result['score'] is None
    assert 'diagnostic' not in result['execution']
