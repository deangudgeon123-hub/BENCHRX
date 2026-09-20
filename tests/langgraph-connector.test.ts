import test from 'node:test';
import assert from 'node:assert/strict';
import {createLangGraphConnector} from '../lib/server/connectors/langgraph.ts';
import {invokeNormalizedConnector, type ConnectorIO} from '../lib/server/connectors/interface.ts';

function pinned(raw: string) {
  const url = new URL(raw);
  return {url, hostname: url.hostname, address: '93.184.216.34', family: 4 as const};
}
const pin: ConnectorIO['pin'] = async (raw) => pinned(raw);

test('LangGraph discovers one assistant and runs stateless wait execution', async () => {
  const calls: Array<{path: string; body?: string}> = [];
  const provider = createLangGraphConnector({pin, request: async (target, options) => {
    calls.push({path: target.url.pathname, body: options.body});
    if (target.url.pathname.endsWith('/assistants/search')) return {status: 200, headers: {}, text: '[{"assistant_id":"agent-1"}]'};
    return {status: 200, headers: {}, text: '{"messages":[{"role":"user","content":"hello"},{"role":"assistant","content":"stateless answer"}]}'};
  }});
  const result = await invokeNormalizedConnector(provider, new URLSearchParams({baseUrl: 'https://graph.example', streaming: '0'}), {message: 'hello'});
  assert.equal(result.outcome, 'observed_response');
  assert.equal(result.response, 'stateless answer');
  assert.equal(result.metadata.assistantId, 'agent-1');
  assert.equal(calls.at(-1)?.path, '/runs/wait');
});

test('LangGraph threaded mode creates a thread before a wait run', async () => {
  const paths: string[] = [];
  const provider = createLangGraphConnector({pin, request: async (target) => {
    paths.push(target.url.pathname);
    if (target.url.pathname.endsWith('/threads')) return {status: 200, headers: {}, text: '{"thread_id":"thread-1"}'};
    return {status: 200, headers: {}, text: '{"messages":[{"type":"ai","content":"threaded answer"}]}'};
  }});
  const result = await invokeNormalizedConnector(provider, new URLSearchParams({
    baseUrl: 'https://graph.example', assistantId: 'agent-1', mode: 'threaded', streaming: '0',
  }), {message: 'hello'});
  assert.equal(result.outcome, 'observed_response');
  assert.equal(result.response, 'threaded answer');
  assert.deepEqual(paths, ['/threads', '/threads/thread-1/runs/wait']);
});

test('LangGraph streaming extracts final assistant message and requires end event', async () => {
  const provider = createLangGraphConnector({pin, request: async () => ({status: 200, headers: {}, text:
    'event: updates\ndata: {"agent":{"messages":[{"role":"assistant","content":"stream answer"}]}}\n\n' +
    'event: end\ndata: {}\n\n'})});
  const result = await invokeNormalizedConnector(provider, new URLSearchParams({
    baseUrl: 'https://graph.example', assistantId: 'agent-1', streaming: '1',
  }), {message: 'hello'});
  assert.equal(result.outcome, 'observed_response');
  assert.equal(result.response, 'stream answer');

  const incompleteProvider = createLangGraphConnector({pin, request: async () => ({status: 200, headers: {}, text:
    'event: updates\ndata: {"agent":{"messages":[{"role":"assistant","content":"partial"}]}}\n\n'})});
  const incomplete = await invokeNormalizedConnector(incompleteProvider, new URLSearchParams({
    baseUrl: 'https://graph.example', assistantId: 'agent-1', streaming: '1',
  }), {message: 'hello'});
  assert.equal(incomplete.outcome, 'connector_failure');
  assert.equal(incomplete.response, null);
});

test('LangGraph failed streams, upstream errors and ambiguous discovery fail closed', async () => {
  const failed = createLangGraphConnector({pin, request: async () => ({status: 200, headers: {}, text: 'event: error\ndata: {"message":"failed"}\n\n'})});
  const failedResult = await invokeNormalizedConnector(failed, new URLSearchParams({baseUrl: 'https://graph.example', assistantId: 'agent-1'}), {message: 'hello'});
  assert.equal(failedResult.outcome, 'connector_failure');
  assert.equal(failedResult.diagnostics?.code, 'failed_run');

  const upstream = createLangGraphConnector({pin, request: async () => ({status: 503, headers: {}, text: '{"messages":[{"role":"assistant","content":"pretend"}]}'} )});
  const upstreamResult = await invokeNormalizedConnector(upstream, new URLSearchParams({baseUrl: 'https://graph.example', assistantId: 'agent-1', streaming: '0'}), {message: 'hello'});
  assert.equal(upstreamResult.outcome, 'connector_failure');
  assert.equal(upstreamResult.status, 503);

  const ambiguous = createLangGraphConnector({pin, request: async () => ({status: 200, headers: {}, text: '[{"assistant_id":"a"},{"assistant_id":"b"}]'})});
  const ambiguousResult = await invokeNormalizedConnector(ambiguous, new URLSearchParams({baseUrl: 'https://graph.example'}), {message: 'hello'});
  assert.equal(ambiguousResult.outcome, 'connector_failure');
  assert.equal(ambiguousResult.diagnostics?.code, 'assistant_ambiguous');
});
