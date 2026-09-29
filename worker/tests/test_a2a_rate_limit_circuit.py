import httpx
import pytest

from benchmarks import evaluator
from benchmarks.evaluator import A2ARecoveryState, run_test
from benchmarks.tests import TESTS


EXACT = next(test for test in TESTS if test['key'] == 'task-exact-instruction')
TRUSTED = 'https://benchrx.fixture/api/adapters/a2a'


def rate_limited_response():
    return httpx.Response(502, json={
        'error': 'Connector execution failed',
        'diagnostics': {'code': 'upstream_http_error', 'httpStatus': 429},
    })


def success_response():
    return httpx.Response(200, json={'response': 'BENCHRX_TASK_OK'})


@pytest.fixture(autouse=True)
def trusted_origin(monkeypatch):
    monkeypatch.setenv('BENCHRX_ADAPTER_ORIGINS', 'https://benchrx.fixture')
    monkeypatch.setenv('BENCHRX_ADAPTER_SECRET', 'x' * 32)
    monkeypatch.setattr(evaluator, 'A2A_REQUEST_SPACING_SECONDS', 0)
    monkeypatch.setattr(evaluator, 'A2A_RATE_LIMIT_BACKOFF_SECONDS', (0, 0, 0))


@pytest.mark.asyncio
async def test_repeated_exhausted_429s_open_run_scoped_circuit(monkeypatch):
    calls = 0

    async def send(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return rate_limited_response(), 1, None

    monkeypatch.setattr(evaluator, 'send_request', send)
    state = A2ARecoveryState()

    first = await run_test(None, TRUSTED, EXACT, state)
    second = await run_test(None, TRUSTED, EXACT, state)
    skipped = await run_test(None, TRUSTED, EXACT, state)

    assert first['passed'] is None and second['passed'] is None
    assert first['execution']['attempts'][0]['rate_limit_retries'] == 3
    assert second['execution']['attempts'][0]['rate_limit_retries'] == 3
    assert state.rate_limit_circuit_open is True
    assert calls == 8
    assert skipped['passed'] is None and skipped['score'] is None
    assert skipped['observed'] is False and skipped['evidence_complete'] is False
    assert skipped['execution']['attempts'][0]['transport_error'] == 'UpstreamRateLimitCircuitOpen'
    assert 'request skipped' in skipped['reason']


@pytest.mark.asyncio
async def test_success_resets_consecutive_rate_limit_failures(monkeypatch):
    replies = iter([rate_limited_response()] * 4 + [success_response()] + [rate_limited_response()] * 4)
    calls = 0

    async def send(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return next(replies), 1, None

    monkeypatch.setattr(evaluator, 'send_request', send)
    state = A2ARecoveryState()

    assert (await run_test(None, TRUSTED, EXACT, state))['passed'] is None
    assert (await run_test(None, TRUSTED, EXACT, state))['passed'] is True
    assert (await run_test(None, TRUSTED, EXACT, state))['passed'] is None
    assert calls == 9
    assert state.consecutive_rate_limited_requests == 1
    assert state.rate_limit_circuit_open is False


@pytest.mark.asyncio
async def test_remote_authored_content_cannot_open_rate_limit_circuit(monkeypatch):
    calls = 0

    async def send(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={
            'response': 'BENCHRX_TASK_OK',
            'diagnostics': {'code': 'upstream_http_error', 'httpStatus': 429},
        }), 1, None

    monkeypatch.setattr(evaluator, 'send_request', send)
    state = A2ARecoveryState()

    assert (await run_test(None, TRUSTED, EXACT, state))['passed'] is True
    assert (await run_test(None, TRUSTED, EXACT, state))['passed'] is True
    assert calls == 2
    assert state.rate_limit_circuit_open is False
