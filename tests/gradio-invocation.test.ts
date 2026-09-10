import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverGradio} from '../lib/server/connectors/gradio-discovery.ts';
import {createGradioConnector} from '../lib/server/connectors/gradio.ts';
import {invokeNormalizedConnector} from '../lib/server/connectors/interface.ts';
const target = {url: new URL('https://agents-course-first-agent-template.hf.space'), hostname: 'agents-course-first-agent-template.hf.space', address: '93.184.216.34', family: 4 as const};
// Public /gradio_api/info and /config retrieved from First_agent_template (Gradio 5.23.1).
const schema = {named_endpoints: {
  '/log_user_message': {parameters: [{parameter_name: 'text_input', type: {type: 'string'}, component: 'Textbox'}], returns: [{label: 'Chat Message', type: {type: 'string'}, component: 'Textbox'}]},
  '/interact_with_agent': {parameters: [{parameter_name: 'messages', type: {type: 'array'}, component: 'Chatbot', parameter_has_default: true, parameter_default: []}], returns: [{label: 'Agent', type: {type: 'array'}, component: 'Chatbot'}]},
}};
const graph = {components: [{id: 1, type: 'state'}, {id: 2, type: 'state'}], dependencies: [
  {id: 0, api_name: 'log_user_message', inputs: [4, 2], outputs: [1, 4], trigger_after: null},
  {id: 1, api_name: 'interact_with_agent', inputs: [1, 3], outputs: [3], trigger_after: 0},
]};
test('First_agent_template invokes logging before agent execution and polls the shared session by event ID', async () => {
  const d = await discoverGradio(target.url.href, {pin: async () => target, request: async t => ({status: 200, headers: {}, text: JSON.stringify(t.url.pathname === '/config' ? graph : schema)})});
  const recipe = d.recipes[0].config;
  const sessions = new Map<string, string>();
  let lastEvent = '', lastData: unknown[] = [], count = 0;
  const provider = createGradioConnector({pin: async () => target, request: async (t, o) => {
    if (o.method === 'POST') {
      const body = JSON.parse(o.body!);
      const session = body.session_hash;
      assert.equal(typeof session, 'string');
      if (t.url.pathname.endsWith('/log_user_message')) {assert.deepEqual(body.data, ['connection fixture', null]); sessions.set(session, body.data[0]); lastData = [null, ''];}
      else {
        assert.ok(sessions.has(session), 'Hidden prompt must be initialized by log_user_message, not by Chatbot input');
        assert.deepEqual(body.data, [null, []]);
        lastData = [[{role: 'user', content: sessions.get(session)}, {role: 'assistant', content: 'Connected'}]];
      }
      lastEvent = `event-${++count}`;
      return {status: 200, headers: {}, text: JSON.stringify({event_id: lastEvent})};
    }
    assert.equal(t.url.pathname, '/gradio_api/queue/data');
    assert.ok(sessions.has(t.url.searchParams.get('session_hash')!));
    return {status: 200, headers: {}, text: `data: ${JSON.stringify({msg: 'process_completed', event_id: lastEvent, success: true, output: {data: lastData}})}\n\n`};
  }});
  const result = await invokeNormalizedConnector(provider, new URLSearchParams(recipe), {message: 'connection fixture'});
  assert.equal(result.outcome, 'observed_response'); assert.equal(result.response, 'Connected'); assert.equal(count, 2);
});
test('single-step Frontier keeps event-id polling without assigning a different queue session', async () => {
  const provider = createGradioConnector({pin: async () => target, request: async (t, o) => {
    if (o.method === 'POST') {
      const body = JSON.parse(o.body!); assert.equal(body.session_hash, undefined);
      assert.deepEqual(body.data, ['fixture']); return {status: 200, headers: {}, text: '{"event_id":"event-1"}'};
    }
    assert.equal(t.url.pathname, '/gradio_api/call/_run/event-1');
    return {status: 200, headers: {}, text: 'event: complete\ndata: [null,null,null,"#### You\\n\\n> fixture\\n\\n#### FrontierAgent\\n\\nConnected"]\n\n'};
  }});
  const r = await invokeNormalizedConnector(provider, new URLSearchParams({space: target.url.href, apiName: '_run', inputs: '["{{message}}"]', outputIndex: '3'}), {message: 'fixture'});
  assert.equal(r.response, 'Connected');
});

test('single-step Gradio 6 falls back from legacy 404 to v2 named-argument queue submission', async () => {
  const calls: string[] = [];
  const provider = createGradioConnector({pin: async () => target, request: async (t, o) => {
    calls.push(`${o.method} ${t.url.pathname}`);
    if (o.method === 'POST' && t.url.pathname === '/gradio_api/call/ask_council') {
      assert.deepEqual(JSON.parse(o.body!), {data: ['fixture']});
      return {status: 404, headers: {}, text: '{"detail":"join queue"}'};
    }
    if (o.method === 'GET' && t.url.pathname === '/gradio_api/info') {
      return {status: 200, headers: {}, text: JSON.stringify({named_endpoints: {'/ask_council': {
        parameters: [{parameter_name: 'question', type: {type: 'string'}, component: 'Textbox'}],
        returns: [{parameter_name: 'output', type: {type: 'string'}, component: 'Textbox'}],
      }}})};
    }
    if (o.method === 'POST' && t.url.pathname === '/gradio_api/call/v2/ask_council') {
      assert.deepEqual(JSON.parse(o.body!), {question: 'fixture'});
      return {status: 200, headers: {}, text: '{"event_id":"event-v2"}'};
    }
    assert.equal(t.url.pathname, '/gradio_api/call/v2/ask_council/event-v2');
    return {status: 200, headers: {}, text: 'event: complete\ndata: ["Council connected"]\n\n'};
  }});
  const r = await invokeNormalizedConnector(provider, new URLSearchParams({space: target.url.href, apiName: 'ask_council', inputs: '["{{message}}"]', outputIndex: '0'}), {message: 'fixture'});
  assert.equal(r.outcome, 'observed_response'); assert.equal(r.response, 'Council connected');
  assert.deepEqual(calls, [
    'POST /gradio_api/call/ask_council',
    'GET /gradio_api/info',
    'POST /gradio_api/call/v2/ask_council',
    'GET /gradio_api/call/v2/ask_council/event-v2',
  ]);
});

test('session SSE accepts only matching successful completion, never partial or another event', async () => {
  const {parseQueueSseComplete} = await import('../lib/server/gradio-output.ts');
  const packet = (msg: string, event_id = 'ours', success = true) => 'data: ' + JSON.stringify({msg, event_id, success, output: {data: ['assistant fixture']}}) + '\n\n';
  assert.deepEqual(parseQueueSseComplete(packet('process_completed', 'other') + packet('process_completed'), 'ours'), ['assistant fixture']);
  for (const stream of [packet('process_generating'), packet('process_completed', 'other'), packet('process_completed', 'ours', false), packet('process_completed').trimEnd(), 'data: invalid\n\n']) {
    assert.throws(() => parseQueueSseComplete(stream, 'ours'));
  }
});

test('Gradio failure diagnostics contain only fixed stage/code/status/index, never upstream details', async () => {
  const original = console.error;
  const logs: unknown[][] = [];
  console.error = (...args) => {logs.push(args);};
  try {
    const provider = createGradioConnector({pin: async () => target, request: async () => {throw new Error('secret credential; private endpoint; fixture prompt; raw answer');}});
    const result = await invokeNormalizedConnector(provider, new URLSearchParams({space: target.url.href, inputs: '["{{message}}"]'}), {message: 'fixture prompt'});
    assert.equal(result.outcome, 'connector_failure');
    assert.deepEqual(logs, [['BENCHRX Gradio invocation failed', {stage: 'submit', code: 'transport', httpStatus: undefined, stepIndex: 0}]]);
    for (const sensitive of ['secret credential', 'private endpoint', 'fixture prompt', 'raw answer']) {
      assert.equal(JSON.stringify({logs, result}).includes(sensitive), false);
    }
  } finally {console.error = original;}
});
