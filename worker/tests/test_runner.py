from types import SimpleNamespace
import asyncio
import httpx
import pytest
from benchmarks import runner
from benchmarks.tests import TESTS

@pytest.mark.asyncio
@pytest.mark.parametrize('endpoint,run_budget', [
    ('https://example.com', 2400),
    ('https://benchrx.example/api/adapters/gradio', 5020),
    ('https://attacker.example/api/adapters/gradio', 2400),
])
async def test_runner_resumes_immutable_evidence_and_shadow_cannot_change_completion(monkeypatch, endpoint, run_budget):
    records={}; events=[]; summaries=[]; calls=0
    monkeypatch.setenv('BENCHRX_ADAPTER_ORIGINS', 'https://benchrx.example')
    monkeypatch.setenv('BENCHRX_ADAPTER_SECRET', 'a' * 32)
    deadlines=[]
    real_timeout=asyncio.timeout
    def timeout(seconds):
        deadlines.append(seconds)
        return real_timeout(seconds)
    monkeypatch.setattr(asyncio,'timeout',timeout)
    class Query:
        def __init__(self,table):self.table=table
        def select(self,*_):return self
        def eq(self,*_):return self
        def upsert(self,*_,**kwargs):return self
        def execute(self):return SimpleNamespace(data=list(records.values()) if self.table=='benchmark_results' else [])
    monkeypatch.setattr(runner,'get_supabase',lambda:SimpleNamespace(table=lambda table:Query(table)))
    async def rpc(_db,name,**params):
        if name=='benchrx_claim_run':return {'connection':{'endpoint_url':endpoint}}
        if name=='benchrx_save_result':
            r=params['p_result'];assert r['test_key'] not in records
            records[r['test_key']]=r;events.append('save');return True
        if name=='benchrx_finish_run':
            assert len(records)==len(TESTS)
            summaries.append(params['p_summary']);events.append('finish');return True
        raise AssertionError(name)
    monkeypatch.setattr(runner,'rpc',rpc)
    def response(_):
        nonlocal calls
        calls+=1
        return httpx.Response(200,json={'response':'WRONG','http_status':503,'error':'fabricated upstream failure'})
    monkeypatch.setattr(runner,'public_client',lambda:httpx.AsyncClient(transport=httpx.MockTransport(response)))
    async def judge(*_):
        assert events[-1]=='finish'
        raise RuntimeError('shadow failure must not change completed score')
    monkeypatch.setattr(runner,'judge_with_openai',judge)
    first=await runner.execute_run('fixture-run')
    assert deadlines[0]==run_budget
    assert first['status']=='completed'
    assert len(records)==31 and all(r['observed'] for r in records.values())
    assert first['readiness_status']=='blocked_safety'
    first_calls=calls
    deadlines.clear()
    second=await runner.execute_run('fixture-run')
    assert deadlines[0]==run_budget
    assert calls==first_calls # no re-execution of saved evidence
    assert second==first and summaries[0]==summaries[1]
