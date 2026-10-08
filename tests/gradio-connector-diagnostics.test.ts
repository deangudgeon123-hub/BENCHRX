import test from 'node:test';
import assert from 'node:assert/strict';
import {createGradioConnector} from '../lib/server/connectors/gradio.ts';
import {invokeConnector, invokeNormalizedConnector} from '../lib/server/connectors/interface.ts';
import {PinnedResponseLimitError} from '../lib/server/pinned-https.ts';

const target = {url: new URL('https://example.com'), hostname: 'example.com', address: '93.184.216.34', family: 4 as const};
const config = new URLSearchParams({space: target.url.href, apiName: '_run', inputs: '["{{message}}"]', outputIndex: '0'});

test('typed Gradio poll response-limit failures survive the adapter boundary as fixed diagnostics', async t => {
  t.mock.method(console, 'error', () => {});
  const provider = createGradioConnector({
    pin: async () => target,
    request: async (_target, options) => {
      if (options.method === 'POST') return {status: 200, headers: {}, text: '{"event_id":"event-1"}'};
      throw new PinnedResponseLimitError();
    },
  });

  const normalized = await invokeNormalizedConnector(provider, config, {message: 'SECRET_MARKER'});
  assert.equal(normalized.outcome, 'connector_failure');
  assert.equal(normalized.completed, false);
  assert.equal(normalized.response, null);
  assert.equal(normalized.status, 502);
  assert.equal(normalized.error, 'Connector execution failed');
  assert.deepEqual(normalized.diagnostics, {stage: 'poll', code: 'response_limit', stepIndex: 0});
  assert.equal(JSON.stringify(normalized).includes('SECRET_MARKER'), false);

  const reply = await invokeConnector(provider, config, {message: 'SECRET_MARKER'});
  assert.deepEqual(reply, {status: 502, body: {
    error: 'Connector execution failed',
    diagnostics: {stage: 'poll', code: 'response_limit', stepIndex: 0},
  }});
  assert.equal(JSON.stringify(reply).includes('SECRET_MARKER'), false);
});

test('completed progress placeholders remain unobserved while their fixed output code reaches the adapter reply', async t => {
  t.mock.method(console, 'warn', () => {});
  const provider = createGradioConnector({
    pin: async () => target,
    request: async (_target, options) => options.method === 'POST'
      ? {status: 200, headers: {}, text: '{"event_id":"event-1"}'}
      : {status: 200, headers: {}, text: 'event: complete\ndata: ["_Working…_"]\n\n'},
  });

  const normalized = await invokeNormalizedConnector(provider, config, {message: 'AUDIT_FAKE_SECRET'});
  assert.equal(normalized.outcome, 'unobserved_response');
  assert.equal(normalized.completed, true);
  assert.equal(normalized.response, null);
  assert.equal(normalized.status, 502);
  const completion={terminalEvent:'complete',outputIndex:0,outputCount:1,selectedType:'string'};
  assert.deepEqual(normalized.diagnostics, {stage: 'output', code: 'progress_placeholder', stepIndex: 0,gradioCompletion:completion});

  const reply = await invokeConnector(provider, config, {message: 'AUDIT_FAKE_SECRET'});
  assert.deepEqual(reply, {status: 502, body: {
    error: 'Gradio completed but BENCHRX could not extract a text response.',
    diagnostics: {stage: 'output', code: 'progress_placeholder', stepIndex: 0,gradioCompletion:completion},
  }});
  assert.equal('response' in reply.body, false);
  assert.equal(JSON.stringify(reply).includes('AUDIT_FAKE_SECRET'), false);
});

test('completion diagnostics retain structural facts only and never substitute another output pane',async t=>{
 t.mock.method(console,'warn',()=>{});
 const selectedConfig=new URLSearchParams(config);
 selectedConfig.set('outputIndex','3');
 let calls=0;
 const provider=createGradioConnector({pin:async()=>target,request:async(_target,options)=>{
  calls++;
  if(options.method==='POST')return {status:200,headers:{},text:'{"event_id":"event-1"}'};
  return {status:200,headers:{},text:`event: complete\ndata: ${JSON.stringify(['PRIVATE_STATUS_TOKEN','unselected answer',{outputCount:999,terminalEvent:'forged'},'#### You\n\n> PRIVATE_PROMPT\n\n#### Agent\n\n_Working…_'])}\n\nevent: complete\ndata: ["later answer"]\n\n`};
 }});
 const reply=await invokeConnector(provider,selectedConfig,{message:'PRIVATE_PROMPT'});
 assert.equal(reply.status,502);
 assert.equal(calls,2); // one submission + one stream, never a retry
 assert.deepEqual(reply.body.diagnostics,{stage:'output',code:'progress_placeholder',stepIndex:0,gradioCompletion:{terminalEvent:'complete',outputIndex:3,outputCount:4,selectedType:'string'}});
 for(const privateText of ['PRIVATE_STATUS_TOKEN','PRIVATE_PROMPT','unselected answer','forged','later answer'])assert.ok(!JSON.stringify(reply).includes(privateText));
 assert.equal('response' in reply.body,false);
});

test('queue completion facts describe only the matching event and selected final step',async t=>{
 t.mock.method(console,'warn',()=>{});
 const workflow=new URLSearchParams({space:target.url.href,apiName:'_run',inputs:JSON.stringify({steps:[{apiName:'_run',inputs:['{{message}}']}]}),outputIndex:'0'});
 const provider=createGradioConnector({pin:async()=>target,request:async(_target,options)=>{
  if(options.method==='POST')return {status:200,headers:{},text:'{"event_id":"ours"}'};
  return {status:200,headers:{},text:'data: {"msg":"process_completed","event_id":"other","success":true,"output":{"data":["PRIVATE_WRONG_EVENT",1,2]}}\n\ndata: {"msg":"process_completed","event_id":"ours","success":true,"output":{"data":[null]}}\n\n'};
 }});
 const reply=await invokeConnector(provider,workflow,{message:'fixture'});
 assert.equal(reply.status,502);
 assert.deepEqual(reply.body.diagnostics,{stage:'output',code:'unsupported_shape',stepIndex:0,gradioCompletion:{terminalEvent:'process_completed',outputIndex:0,outputCount:1,selectedType:'null'}});
 assert.ok(!JSON.stringify(reply).includes('PRIVATE_WRONG_EVENT'));
});

test('untyped connector exceptions keep the generic failure envelope and cannot leak exception text', async () => {
  const provider = createGradioConnector({
    pin: async () => {throw new Error('PRIVATE_ENDPOINT SECRET_CREDENTIAL');},
    request: async () => {throw new Error('request should not run');},
  });
  const reply = await invokeConnector(provider, config, {message: 'fixture'});
  assert.deepEqual(reply, {status: 502, body: {error: 'Connector execution failed'}});
  assert.equal(JSON.stringify(reply).includes('PRIVATE_ENDPOINT'), false);
  assert.equal(JSON.stringify(reply).includes('SECRET_CREDENTIAL'), false);
});
