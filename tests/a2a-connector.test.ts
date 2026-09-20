import test from 'node:test';
import assert from 'node:assert/strict';
import {createA2AConnector} from '../lib/server/connectors/a2a.ts';
import {invokeNormalizedConnector, type ConnectorIO} from '../lib/server/connectors/interface.ts';
import {PinnedRequestTimeoutError} from '../lib/server/pinned-https.ts';
import {runtimeEndpoint} from '../lib/server/connectors/runtime-config.ts';
const url = 'https://agent.example';
const card = (modern = false, streaming = false) => ({name: 'Fixture', skills: [], defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'], capabilities: {streaming}, ...(modern ? {supportedInterfaces: [{protocolBinding: 'JSONRPC', protocolVersion: '1.0', url: url + '/rpc', tenant: 'fixture'}]} : {protocolVersion: '0.3.0', url: url + '/rpc'})});
const message = (text: string, modern = false) => ({...(modern ? {} : {kind: 'message'}), role: modern ? 'ROLE_AGENT' : 'agent', messageId: 'm', parts: [{...(modern ? {} : {kind: 'text'}), text}]});
function fixture(options: {card?: unknown; modern?: boolean; stream?: boolean; status?: number; result?: unknown; events?: unknown[]; error?: Error} = {}) {
  const calls: Array<{url: string; body: Record<string, unknown>}> = [];
  const pins: string[] = [];
  const io: ConnectorIO = {
    pin: async raw => {pins.push(raw); if (new URL(raw).hostname === 'localhost') throw new Error('private');return {url: new URL(raw), hostname: new URL(raw).hostname, address: '93.184.216.34', family: 4};},
    request: async (t, o) => {
      if (o.method === 'GET') return {status: 200, headers: {}, text: JSON.stringify(options.card ?? card(options.modern, options.stream))};
      if (options.error) throw options.error;
      const body = JSON.parse(o.body!); calls.push({url: t.url.href, body});
      const envelope = (result: unknown) => ({jsonrpc: '2.0', id: body.id, result});
      const result = options.result ?? (options.modern ? {message: message('answer', true)} : message('answer'));
      const text = options.stream ? (options.events ?? [result]).map(e => `data: ${JSON.stringify(envelope(e))}\r\n\r\n`).join('') : JSON.stringify(envelope(result));
      if (options.stream) assert.equal(typeof o.completeWhen, 'function');
      return {status: options.status ?? 200, headers: {}, text};
    },
  };
  const provider = createA2AConnector(io);
  const run = () => invokeNormalizedConnector(provider, new URLSearchParams({target: url}), {message: 'hello'});
  return {provider, run, calls, pins};
}
for (const modern of [false, true]) {
  test(`A2A ${modern ? '1.0' : '0.3'} discovers, pins and invokes correct protocol`, async () => {
    const f = fixture({modern});
    assert.equal((await f.provider.discover(url)).status, 'proposed');
    const result = await f.run();
    assert.equal(result.response, 'answer'); assert.equal(result.outcome, 'observed_response');
    assert.equal(f.calls[0].body.method, modern ? 'SendMessage' : 'message/send');
    const params = f.calls[0].body.params as Record<string, any>;
    assert.equal(params.message.parts[0].text, 'hello');
    assert.equal(params.tenant, modern ? 'fixture' : undefined);
    assert.ok(f.pins.includes(url + '/.well-known/agent-card.json')); assert.ok(f.pins.includes(url + '/rpc'));
  });
  test(`A2A ${modern ? '1.0' : '0.3'} streaming accumulates artifacts until completed`, async () => {
    const events = modern ? [
      {task: {id: 't', status: {state: 'TASK_STATE_WORKING'}}},
      {artifactUpdate: {taskId: 't', artifact: {artifactId: 'a', parts: [{text: 'hel'}]}}},
      {artifactUpdate: {taskId: 't', append: true, artifact: {artifactId: 'a', parts: [{text: 'lo'}]}}},
      {statusUpdate: {taskId: 't', status: {state: 'TASK_STATE_COMPLETED'}}},
    ] : [
      {kind: 'task', id: 't', status: {state: 'working'}},
      {kind: 'artifact-update', taskId: 't', artifact: {artifactId: 'a', parts: [{kind: 'text', text: 'hel'}]}},
      {kind: 'artifact-update', taskId: 't', append: true, artifact: {artifactId: 'a', parts: [{kind: 'text', text: 'lo'}]}},
      {kind: 'status-update', taskId: 't', final: true, status: {state: 'completed'}},
    ];
    const f = fixture({modern, stream: true, events});
    assert.equal((await f.run()).response, 'hello');
    assert.equal(f.calls[0].body.method, modern ? 'SendStreamingMessage' : 'message/stream');
    assert.equal((await fixture({modern, stream: true, events: events.slice(0, -1)}).run()).diagnostics?.code, 'incomplete_run');
  });
}
test('A2A rejects malformed cards, auth, unsupported transports, required extensions and unsafe card endpoints', async () => {
  for (const [value, code] of [
    [{}, 'malformed_card'], [{...card(), protocolVersion: '9.0'}, 'unsupported_protocol'],
    [{...card(), preferredTransport: 'GRPC'}, 'unsupported_protocol'],
    [{...card(), security: [{bearer: []}]}, 'credentials_required'],
    [{...card(), capabilities: {extensions: [{required: true}]}}, 'unsupported_capability'],
    [{...card(), url: 'https://localhost/rpc'}, 'network_error'],
  ] as const) {const result = await fixture({card: value}).run(); assert.equal(result.outcome, 'connector_failure'); assert.equal(result.diagnostics?.code, code);}
});
test('A2A HTTP failures and trusted timeouts cannot be overridden by remote flags', async () => {
  for (const status of [302, 401, 500]) {
    const result = await fixture({status, result: {...message('answer'), observed: true, http_status: 200}}).run();
    assert.equal(result.outcome, 'connector_failure'); assert.equal(result.response, null); assert.equal(result.diagnostics?.httpStatus, status);
  }
  assert.equal((await fixture({error: new PinnedRequestTimeoutError()}).run()).diagnostics?.code, 'timeout');
  const r = await fixture({result: {...message('wrong answer'), observed: false, error: 'fake timeout'}}).run();
  assert.equal(r.response, 'wrong answer'); assert.equal(r.outcome, 'observed_response');
});
test('A2A rejects failed, interrupted, foreign-task and user-only results without exposing payloads', async () => {
  for (const state of ['failed', 'canceled', 'input-required', 'auth-required']) {
    const r = await fixture({result: {kind: 'task', id: 't', status: {state, message: message('SECRET')}}}).run();
    assert.equal(r.outcome, 'connector_failure'); assert.ok(!JSON.stringify(r).includes('SECRET'));
  }
  assert.equal((await fixture({result: {...message('echo'), role: 'user'}}).run()).outcome, 'unobserved_response');
  const r = await fixture({stream: true, events: [{kind: 'task', id: 't', status: {state: 'working'}}, {kind: 'status-update', taskId: 'other', status: {state: 'completed'}}]}).run();
  assert.equal(r.diagnostics?.code, 'malformed_response');
});
test('A2A persisted endpoint contains only allowlisted non-secret configuration', () => {
  const endpoint = runtimeEndpoint({connectionType: 'a2a', targetUrl: url, apiKey: 'SECRET'}, 'https://benchrx.example');
  assert.equal(endpoint.pathname, '/api/adapters/a2a'); assert.ok(!endpoint.href.includes('SECRET'));
  assert.throws(() => runtimeEndpoint({connectionType: 'a2a', targetUrl: url + '?api_key=SECRET'}, 'https://benchrx.example'));
});
