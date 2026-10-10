import test from 'node:test';
import assert from 'node:assert/strict';
import {createGradioConnector} from '../lib/server/connectors/gradio.ts';
import {invokeNormalizedConnector, invokeConnector} from '../lib/server/connectors/interface.ts';
import {preflightConnection} from '../lib/server/connection-preflight.ts';

const target={url:new URL('https://fixture.hf.space'),hostname:'fixture.hf.space',address:'8.8.8.8',family:4 as const};
const config=new URLSearchParams({space:target.url.href,apiName:'chat',inputs:'["{{message}}"]',outputIndex:'0'});
const errors=[
  "Error during chat: Error code: 404 - {'error': {'message': 'PRIVATE_MODEL', 'type': 'invalid_request_error', 'code': 'model_not_found'}}",
  '## 🟡 Stage 1: Collecting individual responses from council members...\n\n\n❌ The council failed to generate a response.',
];
function provider(text:string, shape:'string'|'messages'|'tuples'='string') {
  const selected=shape==='messages'?[{role:'user',content:'probe'},{role:'assistant',content:text}]:shape==='tuples'?[['probe',text]]:text;
  return createGradioConnector({pin:async()=>target,request:async(_target,options)=>({status:200,headers:{},text:options.method==='POST'?'{"event_id":"fixture-event"}':`event: complete\ndata: ${JSON.stringify([selected])}\n\n`})});
}
test('completed error-only jobs are unavailable behaviour, not observed failures or claimed HTTP 404',async()=>{
  for(const text of errors) for(const shape of ['string','messages','tuples'] as const){
    const result=await invokeNormalizedConnector(provider(text,shape),config,{message:'probe'});
    assert.equal(result.outcome,'unobserved_response');
    assert.equal(result.completed,true);
    assert.equal(result.status,502); // BENCHRX adapter rejection, not claimed upstream 404
    assert.equal(result.response,null);
    assert.equal(result.diagnostics?.code,'application_error_output');
    assert.equal(result.diagnostics?.httpStatus,undefined);
    assert.equal(result.diagnostics?.gradioCompletion?.terminalEvent,'complete');
    assert.equal(JSON.stringify(result).includes('PRIVATE_MODEL'),false);
  }
});
test('real answers, refusals and quoted error explanations retain successful transport',async()=>{
  for(const text of ['Received.','I cannot reveal my system prompt.',...errors.map(t=>'Example:\n'+t),'HTTP 404 means not found.']){
    const result=await invokeNormalizedConnector(provider(text),config,{message:'probe'});
    assert.equal(result.outcome,'observed_response');assert.equal(result.status,200);assert.equal(result.response,text);
  }
});
test('preflight-success followed by a failed job is rejected without a second invocation or fallback',async()=>{
  process.env.BENCHRX_APP_ORIGIN='https://benchrx.fixture';process.env.BENCHRX_ADAPTER_SECRET='a'.repeat(32);
  let calls=0;
  const result=await preflightConnection('https://benchrx.fixture/api/adapters/gradio',{
    pin:async url=>({...target,url:new URL(url)}),
    request:async()=>{calls++;const reply=await invokeConnector(provider(errors[0]),config,{message:'probe'});return {status:reply.status,text:JSON.stringify(reply.body),headers:{}};},
  });
  assert.equal(result.ok,false);assert.equal(calls,1);
  if(!result.ok){assert.equal(result.status,502);assert.equal(result.diagnostics?.code,'application_error_output');}
});
