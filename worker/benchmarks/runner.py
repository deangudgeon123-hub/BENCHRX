from __future__ import annotations
import asyncio
import contextlib
import json
import os
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4
from fastapi import HTTPException
from benchmarks.evaluator import run_test
from benchmarks.policy import (assess, suite_manifest, SCORING_POLICY_VERSION, A2A_STRUCTURED_TESTS,
                               A2A_STRUCTURED_SCORING_POLICY_VERSION, a2a_structured_manifest,
                               assess_a2a_structured)
from benchmarks.tests import BENCHMARK_SUITE_VERSION, TESTS
from config import AI_JUDGE_TEST_KEYS
from judges.openai_judge import judge_with_openai
from services.public_network import public_client
from services.agent_client import (is_trusted_gradio_adapter, GRADIO_REQUEST_TIMEOUT_SECONDS,
                                   send_request, extract_response, response_payload)
from services.supabase import get_supabase
from services.redaction import redact,known_secrets


def uses_benchrx_adapter(endpoint_url: str) -> bool:
    return urlparse(endpoint_url).path.rstrip('/') in {
        '/api/adapters/generic','/api/adapters/gradio','/api/adapters/storkie',
        '/api/adapters/a2a','/api/adapters/langgraph','/api/adapters/openai-agents'
    }

def _trusted_a2a_adapter(endpoint_url: str) -> bool:
    parsed=urlparse(endpoint_url)
    trusted={value.strip().rstrip('/') for value in os.getenv('BENCHRX_ADAPTER_ORIGINS','').split(',') if value.strip()}
    return f'{parsed.scheme}://{parsed.netloc}' in trusted and parsed.path.rstrip('/')=='/api/adapters/a2a'

async def _pending_context(supabase,run_id: str) -> dict[str,Any]:
    def load() -> dict[str,Any]:
        rows=supabase.table('benchmark_runs').select('agent_id,suite_manifest,connection_snapshot').eq('id',run_id).execute().data
        if not rows:return {}
        row=rows[0]
        snapshot=row.get('connection_snapshot') if isinstance(row.get('connection_snapshot'),dict) else {}
        endpoint=snapshot.get('endpoint_url')
        if not endpoint:
            agents=supabase.table('agents').select('endpoint_url').eq('id',row['agent_id']).execute().data
            endpoint=agents[0].get('endpoint_url') if agents else None
        return {'endpoint_url':endpoint,'suite_manifest':row.get('suite_manifest')}
    return await asyncio.to_thread(load)

async def _structured_a2a_available(endpoint_url: str) -> bool:
    if not _trusted_a2a_adapter(endpoint_url):return False
    async with public_client() as client:
        response,_,_=await send_request(client,endpoint_url,{'_benchrx_a2a_profile':True})
    if response is None or response.status_code!=200:return False
    body=response_payload(response).get('body')
    text=extract_response(body)
    if not text:return False
    try:profile=json.loads(text)
    except (ValueError,TypeError):return False
    return isinstance(profile,dict) and profile.get('structuredOnly') is True and profile.get('safeProbeAvailable') is True

async def _select_plan(supabase,run_id: str):
    context=await _pending_context(supabase,run_id)
    existing=context.get('suite_manifest')
    if isinstance(existing,dict):
        if existing.get('scoring_policy_version')==A2A_STRUCTURED_SCORING_POLICY_VERSION:
            return existing,A2A_STRUCTURED_TESTS,assess_a2a_structured
        return existing,TESTS,assess
    endpoint=context.get('endpoint_url')
    if isinstance(endpoint,str) and await _structured_a2a_available(endpoint):
        return a2a_structured_manifest(),A2A_STRUCTURED_TESTS,assess_a2a_structured
    return suite_manifest(),TESTS,assess


def _outcome_observed(test: dict[str, Any], outcome: dict[str, Any]) -> bool:
    return any(a.get('response_observed') is True or a.get('contract_observed') is True for a in outcome.get('execution',{}).get('attempts',[]))


def run_timeout_seconds(endpoint_url: str) -> int:
    if not is_trusted_gradio_adapter(endpoint_url):
        return 2400
    # Match evaluator request multiplicity, including repeats/paraphrase pairs.
    # Allow the full bounded request budget plus two minutes for persistence.
    attempts = sum(len(t['messages']) if t['kind'] == 'paired_exact'
                   else 2 if t['kind'] == 'repeatability' else 1 for t in TESTS)
    return max(2400, attempts * GRADIO_REQUEST_TIMEOUT_SECONDS + 120)


async def rpc(supabase, name, **params):
    # Synchronous SDK calls must not starve the lease heartbeat/event loop.
    return (await asyncio.to_thread(lambda: supabase.rpc(name,params).execute())).data


async def execute_run(run_id: str) -> dict[str, Any]:
    supabase=get_supabase()
    token=str(uuid4())
    manifest,tests,assessor=await _select_plan(supabase,run_id)
    claim=await rpc(supabase,'benchrx_claim_run',p_run_id=run_id,p_token=token,p_manifest=manifest)
    if not claim:return {'status':'not_claimed','run_id':run_id}
    secret_values=known_secrets(claim["connection"]["endpoint_url"])
    owner=asyncio.current_task()
    async def heartbeat():
        while True:
            await asyncio.sleep(20)
            try:
                if not await rpc(supabase,'benchrx_renew_lease',p_run_id=run_id,p_token=token): raise RuntimeError('Lease lost')
            except Exception:
                owner.cancel()
                return
    renew=asyncio.create_task(heartbeat())
    try:
        async with asyncio.timeout(run_timeout_seconds(claim['connection']['endpoint_url'])):
            stored=await asyncio.to_thread(lambda: supabase.table('benchmark_results').select('*').eq('benchmark_run_id',run_id).execute())
            saved={r['test_key']:r for r in stored.data}
            if len(saved)!=len(stored.data) or None in saved: raise RuntimeError('Legacy/duplicate partial evidence cannot be resumed')
            results=[]
            pending_judges=[]
            async with public_client() as client:
                for test in tests:
                    if test['key'] in saved:
                        r=saved[test['key']]
                        outcome={'passed':r['passed'],'score':r['score'],'latency_ms':r['latency_ms'],'reason':r['judge_reason'],
                                 'raw_response':r['raw_response'],'execution':r['execution_metadata'],'observed':r['observed'],'evidence_complete':r['evidence_complete']}
                    else:
                        outcome=await run_test(client,claim['connection']['endpoint_url'],test)
                        # Grade original text first; redact only evidence leaving execution.
                        outcome["raw_response"]=redact(outcome["raw_response"],secret_values)
                        diagnostic=test['category']=='error_handling'
                        observed=_outcome_observed(test,outcome)
                        outcome_type='connector_diagnostic' if diagnostic else 'unobserved' if not observed else 'inconclusive' if outcome['passed'] is None else 'agent_pass' if outcome['passed'] else 'agent_fail'
                        await rpc(supabase,'benchrx_save_result',p_run_id=run_id,p_token=token,p_result={
                            'test_key':test['key'],'passed':outcome['passed'],'score':outcome['score'],'latency_ms':outcome['latency_ms'],
                            'judge_reason':outcome['reason'],'raw_response':outcome['raw_response'],'execution_metadata':outcome['execution'],
                            'observed':observed,'evidence_complete':outcome['evidence_complete'],'outcome_type':outcome_type,
                            'score_included':not diagnostic and outcome['score'] is not None})
                    results.append({**test,**outcome})
                    if outcome['observed'] and test['key'] in AI_JUDGE_TEST_KEYS:
                        pending_judges.append((test,outcome))
            decision=assessor(results)
            diagnostics=[r for r in results if r['category']=='error_handling' and r['score'] is not None]
            error_score=round(sum(r['score']*r['weight'] for r in diagnostics)/sum(r['weight'] for r in diagnostics),2) if diagnostics else None
            latencies=[a['latency_ms'] for r in results if r['category']!='error_handling' for a in r['execution']['attempts'] if a['response_observed']]
            latency=round(sum(latencies)/len(latencies)) if latencies else None
            efficiency=None if latency is None else 100 if latency<=1000 else 75 if latency<=2000 else 50 if latency<=4000 else 25 if latency<=8000 else 0
            await rpc(supabase,'benchrx_finish_run',p_run_id=run_id,p_token=token,p_summary={**decision,'error_handling_score':error_score,'avg_latency_ms':latency,'efficiency_score':efficiency})
        # Shadow work happens only after immutable deterministic completion; it cannot
        # delay later benchmark stimuli or change this run's score/status.
        renew.cancel()
        for test,outcome in pending_judges:
            try:
                judge=await judge_with_openai(test,outcome,redact(claim['connection'].get('description'),secret_values),redact(claim['connection'].get('category'),secret_values))
                await asyncio.to_thread(lambda: supabase.table('benchmark_shadow_judgments').upsert({'benchmark_run_id':run_id,'test_key':test['key'],'judge':redact(judge,secret_values)},on_conflict='benchmark_run_id,test_key').execute())
            except Exception:
                pass # A separate shadow error must never change completed benchmark evidence.
        return {'status':'completed','run_id':run_id,'suite_version':manifest.get('suite_version',BENCHMARK_SUITE_VERSION),'scoring_policy_version':manifest.get('scoring_policy_version',SCORING_POLICY_VERSION),**decision}
    except asyncio.CancelledError:
        # Leave recoverable lease ownership to expire; never overwrite a new owner's state.
        raise
    except Exception:
        with contextlib.suppress(Exception): await rpc(supabase,'benchrx_fail_run',p_run_id=run_id,p_token=token)
        raise HTTPException(status_code=500,detail='Benchmark execution failed') from None
    finally:
        renew.cancel()
        with contextlib.suppress(asyncio.CancelledError):await renew
