import pytest
from fastapi.testclient import TestClient
import main

@pytest.mark.parametrize('route',['/trigger','/run-next'])
def test_worker_auth_fails_closed(monkeypatch,route):
    client=TestClient(main.app)
    monkeypatch.delenv('BENCHMARK_API_SECRET',raising=False)
    assert client.post(route,json={'run_id':'00000000-0000-0000-0000-000000000001'}).status_code==503
    monkeypatch.setenv('BENCHMARK_API_SECRET','x'*32)
    assert client.post(route,json={'run_id':'00000000-0000-0000-0000-000000000001'}).status_code==401
    assert client.post(route,headers={'Authorization':'Bearer wrong'},json={'run_id':'00000000-0000-0000-0000-000000000001'}).status_code==401

@pytest.mark.parametrize('route',['/trigger','/run-next'])
def test_authorized_calls_reach_runner(monkeypatch,route):
    calls=[]
    async def fake(run):calls.append(run);return {'status':'completed'}
    monkeypatch.setattr(main,'execute_run',fake)
    monkeypatch.setenv('BENCHMARK_API_SECRET','x'*32)
    response=TestClient(main.app).post(route,headers={'Authorization':'Bearer '+'x'*32},json={'run_id':'00000000-0000-0000-0000-000000000001'})
    assert response.status_code==200 and len(calls)==1

def test_authentication_precedes_body_parsing_and_authenticated_body_is_bounded(monkeypatch):
    monkeypatch.setenv('BENCHMARK_API_SECRET','x'*32)
    client=TestClient(main.app)
    assert client.post('/trigger',content='not valid JSON').status_code==401
    assert client.post('/trigger',headers={'Authorization':'Bearer '+'x'*32},content='x'*2049).status_code==413
    assert client.post('/trigger',headers={'Authorization':'Bearer '+'x'*32},json={'run_id':'not-a-uuid'}).status_code==422
