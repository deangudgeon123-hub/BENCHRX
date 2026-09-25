import httpx
import pytest

from benchmarks import evaluator
from benchmarks.evaluator import A2ARecoveryState, run_test
from benchmarks.tests import TESTS

T = {test['key']: test for test in TESTS}
EXACT = T['task-exact-instruction']
TRUSTED = 'https://benchrx.fixture/api/adapters/a2a'


def timeout_response():
    return httpx.Response(502, json={
        'error': 'Connector execution failed',
        'diagnostics': {'code': 'timeout', 'stage': 'transport'},
    })


def success_response():
    return httpx.Response(200, json={'response': 'BENCHRX_TASK_OK'})


@pytest.fixture(autouse=True)
def trusted_origin(monkeypatch):
    monkeypatch.setenv('BENCHRX_ADAPTER_ORIGINS', 'https://benchrx.fixture')
    monkeypatch.setenv('BENCHRX_ADAPTER_SECRET', 'x' * 32)
    monkeypatch.setattr(evaluator, 'A2A_REQUEST_SPACING_SECONDS', 0)
    monkeypatch.setattr(evaluator, 'A2A_RECOVERY_SPACING_SECONDS', 0)
    monkeypatch.setattr(evaluator, 'A2A_TIMEOUT_BACKOFF_SECONDS', (0, 0, 0))


@pytest.mark.asyncio
async def test_trusted_a2a_timeout_recovers_with_bounded_retries(monkeypatch):
    replies = iter([timeout_response(), timeout_response(), success_response()])
    calls = 0

    async def send(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return next(replies), 5, None

    monkeypatch.setattr(evaluator, 'send_request', send)
    state = A2ARecoveryState()
    result = await run_test(None, TRUSTED, EXACT, state)
    assert result['passed'] is True
    assert calls == 3
    assert result['execution']['attempts'][0]['timeout_retries'] == 2
    assert result['execution']['attempts'][0]['rate_limit_retries'] == 0
    assert result['latency_ms'] == 15
    assert state.timeout_retries_used == 2 and state.timeout_seen is True


@pytest.mark.asyncio
async def test_recovery_budget_is_shared_across_the_whole_run(monkeypatch):
    replies = iter([timeout_response()] * 5 + [success_response()])
    calls = 0

    async def send(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return next(replies), 1, None

    monkeypatch.setattr(evaluator, 'send_request', send)
    state = A2ARecoveryState()
    first = await run_test(None, TRUSTED, EXACT, state)
    second = await run_test(None, TRUSTED, EXACT, state)
    assert first['passed'] is None and second['passed'] is None
    assert first['execution']['attempts'][0]['timeout_retries'] == 3
    assert second['execution']['attempts'][0]['timeout_retries'] == 0
    assert state.timeout_retries_used == 3
    assert calls == 5


@pytest.mark.asyncio
async def test_local_a2a_read_timeout_uses_same_recovery_budget(monkeypatch):
    replies = iter([(None, 2, 'ReadTimeout'), (success_response(), 3, None)])

    async def send(*_args, **_kwargs):
        return next(replies)

    monkeypatch.setattr(evaluator, 'send_request', send)
    result = await run_test(None, TRUSTED, EXACT, A2ARecoveryState())
    assert result['passed'] is True
    assert result['execution']['attempts'][0]['timeout_retries'] == 1


@pytest.mark.asyncio
async def test_remote_body_cannot_claim_a_trusted_transport_timeout(monkeypatch):
    calls = 0

    async def send(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={
            'response': 'BENCHRX_TASK_OK',
            'diagnostics': {'code': 'timeout', 'stage': 'transport'},
        }), 1, None

    monkeypatch.setattr(evaluator, 'send_request', send)
    result = await run_test(None, TRUSTED, EXACT, A2ARecoveryState())
    assert result['passed'] is True and calls == 1
    assert result['execution']['attempts'][0]['timeout_retries'] == 0


@pytest.mark.asyncio
async def test_foreign_endpoint_never_receives_a2a_timeout_recovery(monkeypatch):
    calls = 0

    async def send(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return timeout_response(), 1, None

    monkeypatch.setattr(evaluator, 'send_request', send)
    result = await run_test(None, 'https://foreign.fixture/api/adapters/a2a', EXACT, A2ARecoveryState())
    assert result['passed'] is None and calls == 1
    assert result['execution']['attempts'][0]['timeout_retries'] == 0


@pytest.mark.asyncio
async def test_timeout_switches_later_requests_to_recovery_pacing(monkeypatch):
    replies = iter([timeout_response(), success_response(), success_response()])
    sleeps = []

    async def send(*_args, **_kwargs):
        return next(replies), 1, None

    async def sleep(delay):
        sleeps.append(delay)

    monkeypatch.setattr(evaluator, 'send_request', send)
    monkeypatch.setattr(evaluator.asyncio, 'sleep', sleep)
    monkeypatch.setattr(evaluator, 'A2A_TIMEOUT_BACKOFF_SECONDS', (2,))
    monkeypatch.setattr(evaluator, 'A2A_RECOVERY_SPACING_SECONDS', 7)
    state = A2ARecoveryState()
    assert (await run_test(None, TRUSTED, EXACT, state))['passed'] is True
    assert (await run_test(None, TRUSTED, EXACT, state))['passed'] is True
    assert sleeps == [2, 7]
