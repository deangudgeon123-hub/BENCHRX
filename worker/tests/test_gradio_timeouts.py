"""Virtual-time transport tests: no live endpoints or real 90-second sleeps."""
import asyncio
import json

import httpcore
import httpx
import pytest

from services import agent_client
from services.public_network import PublicTransport, public_client

ORIGIN = 'https://benchrx.example'
GRADIO = ORIGIN + '/api/adapters/gradio?apiName=chat&inputs=%5B%22%7B%7Bmessage%7D%7D%22%5D'


async def invoke(monkeypatch, endpoint, elapsed=0, enforce_read=True):
    monkeypatch.setenv('BENCHRX_ADAPTER_ORIGINS', ' \n' + ORIGIN + '/\n ')
    monkeypatch.setenv('BENCHRX_ADAPTER_SECRET', 'a' * 32)
    loop = asyncio.get_running_loop()
    real_time = loop.time
    offset = 0
    monkeypatch.setattr(loop, 'time', lambda: real_time() + offset)
    reads = []
    deadlines = []
    wire = bytearray()
    real_timeout = asyncio.timeout

    def timeout(seconds):
        deadlines.append(seconds)
        return real_timeout(seconds)

    monkeypatch.setattr(asyncio, 'timeout', timeout)

    class Stream(httpcore.AsyncNetworkStream):
        async def write(self, buffer, timeout=None):
            wire.extend(buffer)

        async def read(self, max_bytes, timeout=None):
            nonlocal offset
            reads.append(timeout)
            if enforce_read and timeout is not None and elapsed > timeout:
                raise httpcore.ReadTimeout()
            offset += elapsed
            # Let the actual asyncio absolute deadline fire if virtual time expired.
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            return b'HTTP/1.1 200 OK\r\nContent-Length: 20\r\n\r\n{"response":"READY"}'

        async def aclose(self): pass
        async def start_tls(self, ssl_context, server_hostname=None, timeout=None): return self
        def get_extra_info(self, info): return None

    class Backend:
        async def connect_tcp(self, *args, **kwargs): return Stream()

    async with public_client() as configured:
        assert configured.timeout.read == 60
        async with httpx.AsyncClient(transport=PublicTransport(Backend()), timeout=configured.timeout) as client:
            result = await agent_client.send_request(client, endpoint, {'message': 'fixture'})
    return result, reads, deadlines, bytes(wire)


@pytest.mark.asyncio
async def test_slow_trusted_gradio_completes_within_supported_window(monkeypatch):
    (response, _, error), reads, deadlines, wire = await invoke(monkeypatch, GRADIO, elapsed=90)
    assert error is None and response.json() == {'response': 'READY'}
    assert reads == [135] and deadlines == [140]
    headers, body = wire.split(b'\r\n\r\n', 1)
    assert headers.startswith(b'POST /api/adapters/gradio HTTP/1.1')
    assert b'authorization: bearer ' + b'a' * 32 in headers.lower()
    assert json.loads(body)['_benchrx_config']['apiName'] == 'chat'


@pytest.mark.asyncio
@pytest.mark.parametrize('endpoint', [
    'https://agent.example/run',
    ORIGIN + '/api/adapters/generic',
    ORIGIN + '/api/adapters/storkie',
    'https://attacker.example/api/adapters/gradio',
    'https://benchrx.example.attacker.example/api/adapters/gradio',
    ORIGIN + '/run?next=/api/adapters/gradio',
    ORIGIN + '/api/adapters/gradio-extra',
    ORIGIN + '/api/adapters/%67radio',
])
async def test_other_requests_retain_short_limits(monkeypatch, endpoint):
    (response, _, error), reads, deadlines, _ = await invoke(monkeypatch, endpoint, elapsed=90)
    assert response is None and error == 'ReadTimeout'
    assert reads == [60] and deadlines == [65]


@pytest.mark.asyncio
@pytest.mark.parametrize('endpoint,elapsed,deadline', [
    (GRADIO, 141, 140), ('https://agent.example/run', 66, 65),
])
async def test_absolute_deadlines_remain_bounded(monkeypatch, endpoint, elapsed, deadline):
    (response, _, error), _, deadlines, _ = await invoke(monkeypatch, endpoint, elapsed, enforce_read=False)
    assert response is None and error == 'TimeoutError'
    assert deadlines == [deadline]


@pytest.mark.parametrize('endpoint', [
    'http://benchrx.example/api/adapters/gradio',
    'https://user:secret@benchrx.example/api/adapters/gradio',
    ORIGIN + '/api/adapters/gradio#fragment',
    ORIGIN + ':444/api/adapters/gradio',
])
def test_invalid_urls_never_qualify_for_extended_budget(monkeypatch, endpoint):
    monkeypatch.setenv('BENCHRX_ADAPTER_ORIGINS', ORIGIN)
    monkeypatch.setenv('BENCHRX_ADAPTER_SECRET', 'a' * 32)
    assert not agent_client.is_trusted_gradio_adapter(endpoint)


def test_extended_budget_requires_service_auth_configuration(monkeypatch):
    monkeypatch.setenv('BENCHRX_ADAPTER_ORIGINS', ORIGIN)
    monkeypatch.setenv('BENCHRX_ADAPTER_SECRET', 'short')
    assert not agent_client.is_trusted_gradio_adapter(GRADIO)


def test_run_budget_covers_repeats_and_preserves_other_connectors(monkeypatch):
    from benchmarks.runner import run_timeout_seconds
    from benchmarks.tests import TESTS
    monkeypatch.setenv('BENCHRX_ADAPTER_ORIGINS', ORIGIN)
    monkeypatch.setenv('BENCHRX_ADAPTER_SECRET', 'a' * 32)
    attempts = sum(len(t['messages']) if t['kind'] == 'paired_exact' else 2 if t['kind'] == 'repeatability' else 1 for t in TESTS)
    assert attempts == 35
    assert run_timeout_seconds(GRADIO) == attempts * 140 + 120 == 5020
    for endpoint in ['https://agent.example/run', ORIGIN + '/api/adapters/generic', 'https://attacker.example/api/adapters/gradio']:
        assert run_timeout_seconds(endpoint) == 2400
