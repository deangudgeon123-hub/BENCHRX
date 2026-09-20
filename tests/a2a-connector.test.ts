import test from 'node:test';
import assert from 'node:assert/strict';
import {createA2AConnector} from '../lib/server/connectors/a2a.ts';
import {invokeNormalizedConnector, type ConnectorIO} from '../lib/server/connectors/interface.ts';

function pinned(raw: string) {
  const url = new URL(raw);
  return {url, hostname: url.hostname, address: '93.184.216.34', family: 4 as const};
}
const pin: ConnectorIO['pin'] = async (raw) => pinned(raw);
function card(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    name: 'Fixture Agent', description: 'fixture', version: '1.0',
    supportedInterfaces: [{url: 'https://agent.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0'}],
    capabilities: {streaming: false}, defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'], skills: [], ...overrides,
  });
}

test('A2A discovers current Agent Cards and sends synchronous JSON-RPC messages', async () => {
  const requests: Array<{url: string; body?: string}> = [];
  const provider = createA2AConnector({pin, request: async (target, options) => {
    requests.push({url: target.url.toString(), body: options.body});
    if (options.method === 'GET') return {status: 200, headers: {}, text: card()};
    return {status: 200, headers: {}, text: JSON.stringify({jsonrpc: '2.0', id: '1', result: {message: {role: 'ROLE_AGENT', messageId: 'm2', parts: [{text: 'hello from a2a'}]}}})};
  }});
  const discovery = await provider.discover('https://agent.example/app');
  assert.equal(discovery.provider, 'a2a');
  const result = await invokeNormalizedConnector(provider, new URLSearchParams({baseUrl: 'https://agent.example/app'}), {message: 'hello'});
  assert.equal(result.outcome, 'observed_response');
  assert.equal(result.response, 'hello from a2a');
  assert.equal(result.metadata.protocolVersion, '1.0');
  const sent = JSON.parse(requests.at(-1)!.body!);
  assert.equal(sent.method, 'SendMessage');
  assert.equal(sent.params.message.role, 'ROLE_USER');
  assert.equal(sent.params.message.parts[0].text, 'hello');
});

test('A2A streams artifact output until terminal status', async () => {
  const provider = createA2AConnector({pin, request: async (_target, options) => {
    if (options.method === 'GET') return {status: 200, headers: {}, text: card({capabilities: {streaming: true}})};
    return {status: 200, headers: {'content-type': 'text/event-stream'}, text:
      'data: {"jsonrpc":"2.0","id":"1","result":{"task":{"id":"t","status":{"state":"TASK_STATE_WORKING"}}}}\n\n' +
      'data: {"jsonrpc":"2.0","id":"1","result":{"artifactUpdate":{"taskId":"t","artifact":{"parts":[{"text":"streamed answer"}]}}}}\n\n' +
      'data: {"jsonrpc":"2.0","id":"1","result":{"statusUpdate":{"taskId":"t","status":{"state":"TASK_STATE_COMPLETED"}}}}\n\n'};
  }});
  const result = await invokeNormalizedConnector(provider, new URLSearchParams({baseUrl: 'https://agent.example'}), {message: 'hello'});
  assert.equal(result.outcome, 'observed_response');
  assert.equal(result.response, 'streamed answer');
  assert.equal(result.metadata.streaming, true);
});

test('A2A supports HTTP+JSON and extracts completed task artifacts', async () => {
  const provider = createA2AConnector({pin, request: async (target, options) => {
    if (options.method === 'GET') return {status: 200, headers: {}, text: card({supportedInterfaces: [{url: 'https://agent.example/a2a/v1', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0'}]})};
    assert.equal(target.url.pathname, '/a2a/v1/message:send');
    return {status: 200, headers: {}, text: JSON.stringify({task: {id: 't', status: {state: 'TASK_STATE_COMPLETED'}, artifacts: [{parts: [{text: 'artifact answer'}]}]}})};
  }});
  const result = await invokeNormalizedConnector(provider, new URLSearchParams({baseUrl: 'https://agent.example'}), {message: 'hello'});
  assert.equal(result.outcome, 'observed_response');
  assert.equal(result.response, 'artifact answer');
});

test('A2A malformed cards and unsupported required capabilities fail closed', async () => {
  for (const text of [
    'not json',
    card({supportedInterfaces: [{url: 'https://agent.example', protocolBinding: 'GRPC', protocolVersion: '1.0'}]}),
    card({securityRequirements: [{bearer: []}]}),
    card({capabilities: {extensions: [{uri: 'x', required: true}]}}),
  ]) {
    const provider = createA2AConnector({pin, request: async () => ({status: 200, headers: {}, text})});
    const result = await invokeNormalizedConnector(provider, new URLSearchParams({baseUrl: 'https://agent.example'}), {message: 'hello'});
    assert.equal(result.outcome, 'connector_failure');
    assert.equal(result.response, null);
    assert.equal(result.diagnostics?.stage, 'validation');
  }
});

test('A2A upstream failures and incomplete streams never become observed', async () => {
  const httpProvider = createA2AConnector({pin, request: async (_target, options) => options.method === 'GET'
    ? {status: 200, headers: {}, text: card()}
    : {status: 503, headers: {}, text: '{"message":{"role":"ROLE_AGENT","parts":[{"text":"pretend success"}]}}'}});
  const http = await invokeNormalizedConnector(httpProvider, new URLSearchParams({baseUrl: 'https://agent.example'}), {message: 'hello'});
  assert.equal(http.outcome, 'connector_failure');
  assert.equal(http.status, 503);

  const streamProvider = createA2AConnector({pin, request: async (_target, options) => options.method === 'GET'
    ? {status: 200, headers: {}, text: card({capabilities: {streaming: true}})}
    : {status: 200, headers: {}, text: 'data: {"jsonrpc":"2.0","id":"1","result":{"task":{"id":"t","status":{"state":"TASK_STATE_WORKING"}}}}\n\n'}});
  const stream = await invokeNormalizedConnector(streamProvider, new URLSearchParams({baseUrl: 'https://agent.example'}), {message: 'hello'});
  assert.equal(stream.outcome, 'connector_failure');
  assert.equal(stream.response, null);
  assert.equal(stream.diagnostics?.code, 'incomplete_stream');
});
