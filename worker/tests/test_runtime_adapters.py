import json
import pytest
from test_gradio_timeouts import invoke, ORIGIN

@pytest.mark.asyncio
@pytest.mark.parametrize('provider', ['a2a'])
async def test_runtime_adapter_auth_and_private_body(monkeypatch, provider):
    endpoint = ORIGIN + '/api/adapters/' + provider + '?target=https%3A%2F%2Fagent.example&mode=auto'
    (response, _, error), reads, deadlines, wire = await invoke(monkeypatch, endpoint)
    assert error is None and response.status_code == 200
    headers, body = wire.split(b'\r\n\r\n', 1)
    assert b'?target=' not in headers
    assert b'authorization: bearer ' + b'a' * 32 in headers.lower()
    assert json.loads(body)['_benchrx_config']['target'] == 'https://agent.example'
    assert reads == [60] and deadlines == [65]

@pytest.mark.asyncio
async def test_foreign_runtime_adapter_never_receives_service_secret(monkeypatch):
    (_, _, _), _, _, wire = await invoke(monkeypatch, 'https://attacker.example/api/adapters/a2a')
    assert b'authorization:' not in wire.lower()
    assert b'_benchrx_config' not in wire
