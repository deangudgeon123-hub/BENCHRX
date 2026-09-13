import test from 'node:test';
import assert from 'node:assert/strict';
import {createGradioConnector} from '../lib/server/connectors/gradio.ts';
import {invokeNormalizedConnector} from '../lib/server/connectors/interface.ts';
import {hasNamedCallTerminalEvent, parseSseComplete} from '../lib/server/gradio-output.ts';

const target = {url: new URL('https://example.com'), hostname: 'example.com', address: '93.184.216.34', family: 4 as const};
const config = new URLSearchParams({space: target.url.href, apiName: '_run', inputs: '["{{message}}"]', outputIndex: '3'});
const completion = (answer: string) => `event: complete\ndata: ${JSON.stringify([null, null, null, answer])}\n\n`;

test('named Gradio complete is protocol-terminal even when final output is a non-evidence placeholder', async t => {
  t.mock.method(console, 'warn', () => {});
  const working = completion('_Working…_');
  assert.equal(hasNamedCallTerminalEvent(working), true);
  assert.deepEqual(parseSseComplete(working), [null, null, null, '_Working…_']);

  const provider = createGradioConnector({
    pin: async () => target,
    request: async (_target, options) => {
      if (options.method === 'POST') return {status: 200, headers: {}, text: '{"event_id":"event-1"}'};
      assert.equal(options.completeWhen?.(working), true);
      return {status: 200, headers: {}, text: working};
    },
  });

  const result = await invokeNormalizedConnector(provider, config, {message: 'fixture'});
  assert.equal(result.outcome, 'unobserved_response');
  assert.equal(result.completed, true);
  assert.equal(result.response, null);
  assert.deepEqual(result.diagnostics, {stage: 'output', code: 'progress_placeholder', stepIndex: 0});
});

test('first protocol-terminal completion wins; response content cannot force transport continuation', () => {
  const working = completion('_Working…_');
  const impossibleLater = completion('#### You\n\n> fixture\n\n#### FrontierAgent\n\nLater answer');
  assert.equal(hasNamedCallTerminalEvent(working + impossibleLater), true);
  assert.deepEqual(parseSseComplete(working + impossibleLater), [null, null, null, '_Working…_']);
});

test('named Gradio error event remains terminal and fail-closed', () => {
  const stream = 'event: error\ndata: upstream failed\n\n';
  assert.equal(hasNamedCallTerminalEvent(stream), true);
  assert.throws(() => parseSseComplete(stream));
});
