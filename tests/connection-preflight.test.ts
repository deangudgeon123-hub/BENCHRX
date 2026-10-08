import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightConnection} from '../lib/server/connection-preflight.ts';
import type {ConnectorIO} from '../lib/server/connectors/interface.ts';
process.env.BENCHRX_APP_ORIGIN='https://benchrx.fixture';
process.env.BENCHRX_ADAPTER_SECRET='a'.repeat(32);
process.env.VERCEL_AUTOMATION_BYPASS_SECRET='private-bypass';

function fakeIO(status=200,text='{"response":"Received"}') {
 const calls: {url:string;options:Parameters<ConnectorIO['request']>[1]}[]=[];
 const io:ConnectorIO={
  async pin(url){return {url:new URL(url),hostname:new URL(url).hostname,address:'8.8.8.8',family:4};},
  async request(target,options){calls.push({url:target.url.href,options});return {status,text,headers:{}};},
 };
 return {io,calls};
}
test('native preflight requires the same usable response string as the worker',async()=>{
 for(const body of [null,{},[],{error:'PRIVATE_ERROR'},{response:null},{response:123},{response:''},{response:'   '}]){
  const {io}=fakeIO(200,JSON.stringify(body));
  assert.deepEqual(await preflightConnection('https://agent.fixture',io),{ok:false,status:502,diagnostics:{stage:'extraction',code:'missing_response'}});
 }
 const malformed=fakeIO(200,'<html>PRIVATE_PROVIDER_PAGE</html>');
 assert.equal((await preflightConnection('https://agent.fixture',malformed.io)).ok,false);
 for(const text of ['Received','WRONG','I cannot reveal my system prompt']){
  const {io,calls}=fakeIO(200,JSON.stringify({response:text}));
  assert.deepEqual(await preflightConnection('https://agent.fixture/path?token=PRIVATE_TOKEN',io),{ok:true});
  assert.equal(calls[0].url,'https://agent.fixture/path?token=PRIVATE_TOKEN');
  assert.equal(calls[0].options.headers?.Authorization,undefined);
  assert.equal(calls[0].options.headers?.['x-vercel-protection-bypass'],undefined);
 }
});
test('HTTP failures, redirects, timeouts and invalid targets fail preflight without leaking content',async()=>{
 for(const status of [302,401,403,404,429,500,502]){
  const {io}=fakeIO(status,JSON.stringify({response:'PRIVATE_TEXT',diagnostics:{stage:'PRIVATE_STAGE',code:'PRIVATE_CODE'}}));
  const result=await preflightConnection('https://agent.fixture',io);
  assert.deepEqual(result,{ok:false,status:status===302?502:status});
 }
 const {io}=fakeIO();
 io.pin=async()=>{throw new Error('PRIVATE_DNS_ERROR');};
 assert.deepEqual(await preflightConnection('https://agent.fixture',io),{ok:false,status:502,diagnostics:{stage:'connection_test',code:'request_failed'}});
});
test('adapter preflight uses authenticated private config and correct request budgets',async()=>{
 for(const provider of ['a2a','gradio','generic','langgraph','openai-agents']){
  const {io,calls}=fakeIO();
  const result=await preflightConnection(`https://benchrx.fixture/api/adapters/${provider}?target=https%3A%2F%2Fagent.fixture&inputs=%5B%22%7B%7Bmessage%7D%7D%22%5D`,io);
  assert.equal(result.ok,true);
  if(result.ok) assert.equal(result.suitability?.status,provider==='a2a'?'unverified':undefined);
  assert.equal(calls[0].url,`https://benchrx.fixture/api/adapters/${provider}`);
  assert.equal(calls[0].options.headers?.Authorization,`Bearer ${'a'.repeat(32)}`);
  assert.equal(calls[0].options.headers?.['x-vercel-protection-bypass'],'private-bypass');
  const body=JSON.parse(String(calls[0].options.body));
  assert.equal(body._benchrx_config.target,'https://agent.fixture');
  assert.equal(body._benchrx_connection_test,provider==='a2a');
  assert.equal(calls[0].options.timeoutMs,provider==='gradio'?135000:65000);
 }
});
test('A2A suitability is advisory and cannot turn remote content into trusted transport status',async()=>{
 for(const response of ['Whisper: name a skill to run one','Sidequest is deterministic and read-only','BENCHRX_CONNECTION_OK']) {
  const {io,calls}=fakeIO(200,JSON.stringify({response,inputModes:['text/plain'],suitability:{status:'candidate'},ok:true}));
  const result=await preflightConnection('https://benchrx.fixture/api/adapters/a2a',io);
  assert.equal(result.ok,true);
  if(result.ok) assert.equal(result.suitability?.status,response==='BENCHRX_CONNECTION_OK'?'candidate':'unverified');
  assert.equal(calls.length,1); // reuses the connection test, no extra upstream request
  assert.ok(!JSON.stringify(result).includes('Whisper:'));
 }
 const failed=fakeIO(502,JSON.stringify({response:'BENCHRX_CONNECTION_OK',ok:true}));
 assert.equal((await preflightConnection('https://benchrx.fixture/api/adapters/a2a',failed.io)).ok,false);
 const native=fakeIO(200,JSON.stringify({response:'BENCHRX_CONNECTION_OK',provider:'a2a'}));
 assert.deepEqual(await preflightConnection('https://native.fixture',native.io),{ok:true});
});
test('only trusted adapter diagnostics are exposed and configuration failures stop before requests',async(t)=>{
 const {io}=fakeIO(502,JSON.stringify({error:'PRIVATE_ERROR',diagnostics:{code:'protocol_error',stage:'protocol',httpStatus:422,detail:'PRIVATE_DETAIL'}}));
 assert.deepEqual(await preflightConnection('https://benchrx.fixture/api/adapters/a2a',io),{ok:false,status:502,diagnostics:{code:'protocol_error',stage:'protocol',httpStatus:422}});
 t.mock.method(io,'request',async()=>{throw new Error('must not request when unconfigured');});
 const secret=process.env.BENCHRX_ADAPTER_SECRET;
 process.env.BENCHRX_ADAPTER_SECRET='short';
 try {assert.deepEqual(await preflightConnection('https://benchrx.fixture/api/adapters/a2a',io),{ok:false,status:503,diagnostics:{stage:'configuration',code:'adapter_not_configured'}});}finally{process.env.BENCHRX_ADAPTER_SECRET=secret;}
 const external=fakeIO();
 await preflightConnection('https://attacker.fixture/api/adapters/a2a',external.io);
 assert.equal(external.calls[0].options.headers?.Authorization,undefined);
 assert.equal(JSON.parse(String(external.calls[0].options.body))._benchrx_config,undefined);
});
