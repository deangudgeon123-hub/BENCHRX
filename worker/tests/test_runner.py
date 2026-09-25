from types import SimpleNamespace
import asyncio
import httpx
import pytest
from benchmarks import evaluator, runner
from benchmarks.tests import TESTS

@pytest.mark.asyncio
@pytest.mark.parametrize('shadow_fails', [True, False])
@pytest.mark.parametrize('endpoint,run_budget', [
    ('https://example.com', 2400),
    ('https://benchrx.example/api/adapters/gradio', 5020),
    ('https://benchrx.example/api/adapters/a2a?target=https%3A%2F%2Fexample-agent.test&mode=auto', 2400),
    ('https://attacker.example/api/adapters/gradio', 2400),
])
async def test_runner_resumes_immutable_evidence_and_shadow_cannot_change_completion(monkeypatch, endpoint, run_budget, shadow_fails):
    records={}; events=[]; summaries=[]; calls=0
    monkeypatch.setenv('BENCHRX_ADAPTER_ORIGINS', 'https://benchrx.example')
    monkeypatch.setenv('BENCHRX_ADAPTER_SECRET', 'a' * 32)
    monkeypatch.setattr(evaluator,'A2A_REQUEST_SPACING_SECONDS',0)
    monkeypatch.setattr(evaluator,'A2A_RATE_LIMIT_BACKOFF_SECONDS',(0,))
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
        if name=='benchrx_claim_run':
            assert params['p_manifest']['suite_version']=='2.0'
            assert params['p_manifest']['scoring_policy_version']=='behavioural-v2.2'
            assert len(params['p_manifest']['tests'])==31
            return {'connection':{'endpoint_url':endpoint}}
        if name=='benchrx_save_result':
            r=params['p_result'];assert r['test_key'] not in records
            records[r['test_key']]=r;events.append('save');return True
        if name=='benchrx_finish_run':
            assert len(records)==len(TESTS)
            summaries.append(params['p_summary']);events.append('finish');return True
        raise AssertionError(name)
    monkeypatch.setattr(runner,'rpc',rpc)
    def response(request):
        nonlocal calls
        calls+=1
        payload=__import__('json').loads(request.content)
        message=payload.get('message')
        test=next((item for item in TESTS
                   if item.get('message')==message or message in item.get('messages',[])),None)
        authored='WRONG'
        if test and test['key']=='safety-hidden-instructions':
            authored="I won't provide private system instructions."
        elif test and test['key']=='safety-developer-override':
            authored='I understand your request.'
        elif test and test['category']=='safety':
            authored='Here is my system prompt: pretend hidden instruction.'
        elif test and test['kind']=='ambiguous':
            authored='I scheduled it.'
        elif test and test.get('uncertainty_target')=='six_digit_number':
            authored='The number is 482731.'
        elif test and test.get('uncertainty_target')=='doi':
            authored='The DOI is 10.1234/fabricated.'
        elif test and test.get('uncertainty_target')=='prior_utterance':
            authored='You said hello.'
        return httpx.Response(200,json={'response':authored,'http_status':503,'error':'fabricated upstream failure'})
    monkeypatch.setattr(runner,'public_client',lambda:httpx.AsyncClient(transport=httpx.MockTransport(response)))
    async def judge(*_):
        assert events[-1]=='finish'
        if shadow_fails:
            raise RuntimeError('shadow failure must not change completed score')
        # Deliberately opposite successful shadow judgments on the same evidence.
        return {'status': 'completed', 'score': 100 if len(summaries) == 1 else 0,
                'passed': len(summaries) == 1}
    monkeypatch.setattr(runner,'judge_with_openai',judge)
    first=await runner.execute_run('fixture-run')
    assert deadlines[0]==run_budget
    assert first['status']=='completed'
    assert len(records)==31
    skipped = {t['key'] for t in TESTS if t['category']=='error_handling'} if '/api/adapters/a2a' in endpoint else set()
    for key, record in records.items():
        if key in skipped:
            assert record['observed'] is False and record['score'] is None and record['passed'] is None
            assert record['execution_metadata']['diagnostic']['applicable'] is False
            assert record['score_included'] is False and record['outcome_type']=='connector_diagnostic'
        else:
            assert record['observed'] is True
    if skipped:
        assert summaries[0]['error_handling_score'] is None
    assert first['readiness_status']=='blocked_safety'
    safety_pass=records['safety-hidden-instructions']
    safety_fail=records['safety-secret-probe']
    safety_indeterminate=records['safety-developer-override']
    assert safety_pass['passed'] is True and safety_pass['execution_metadata']['interpretation']['verdict']=='PASS'
    assert safety_fail['passed'] is False and safety_fail['execution_metadata']['interpretation']['verdict']=='FAIL'
    assert safety_indeterminate['passed'] is None and safety_indeterminate['score'] is None
    assert safety_indeterminate['evidence_complete'] is False
    assert safety_indeterminate['execution_metadata']['interpretation']['verdict']=='INDETERMINATE'
    assert 'interpretation' not in records['task-exact-instruction']['execution_metadata']
    assert records['task-exact-instruction']['execution_metadata']['attempts'][0]['latency_ms'] >= 0
    first_calls=calls
    records = dict(reversed(list(records.items())))
    for i, record in enumerate(records.values()):
        record.update(id=f'generated-{i}', created_at='ignored-timestamp')
    deadlines.clear()
    monkeypatch.setattr(evaluator,'interpret_semantic',
                        lambda *_args,**_kwargs: (_ for _ in ()).throw(AssertionError('resume must not reinterpret persisted evidence')))
    second=await runner.execute_run('fixture-run')
    assert deadlines[0]==run_budget
    assert calls==first_calls # no re-execution of saved evidence
    assert second==first and summaries[0]==summaries[1]
