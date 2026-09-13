import test from 'node:test';
import assert from 'node:assert/strict';
import {createGradioConnector} from '../lib/server/connectors/gradio.ts';
import {invokeNormalizedConnector} from '../lib/server/connectors/interface.ts';
import {hasNamedCallTerminalEvent, parseSseComplete} from '../lib/server/gradio-output.ts';

const target = {url: new URL('https://example.com'), hostname: 'example.com', address: '93.184.216.34', family: 4 as const};
const config = new URLSearchParams({space: target.url.href, apiName: '_run', inputs: '["{{message}}"]', outputIndex: '3'});
const completion = (answer: string) => `event: complete\ndata: ${JSON.stringify([null, null, null, answer])}\n\n`;

test('named Gradio completion keeps a known progress snapshot provisional until a later final snapshot', async () => {
  const working = completion('_Working…_');
  const final = completion('#### You\n\n> fixture\n\n#### FrontierAgent\n\nFinal answer');

  assert.equal(hasNamedCallTerminalEvent(working), false);
  assert.equal(hasNamedCallTerminalEvent(working + final), true);
  assert.deepEqual(parseSseComplete(working + final), [null, null, null, '#### You\n\n> fixture\n\n#### FrontierAgent\n\nFinal answer']);

  const provider = createGradioConnector({
    pin: async () => target,
    request: async (_target, options) => {
      if (options.method === 'POST') return {status: 200, headers: {}, text: '{"event_id":"event-1"}'};
      assert.equal(options.completeWhen?.(working), false);
      assert.equal(options.completeWhen?.(working + final), true);
      return {status: 200, headers: {}, text: working + final};
    },
  });

  const result = await invokeNormalizedConnector(provider, config, {message: 'fixture'});
  assert.equal(result.outcome, 'observed_response');
  assert.equal(result.completed, true);
  assert.equal(result.response, 'Final answer');
});

test('a progress snapshot remains unobserved if the upstream stream actually ends without a final answer', async t => {
  t.mock.method(console, 'warn', () => {});
  const working = completion('_Working…_');
  const provider = createGradioConnector({
    pin: async () => target,
    request: async (_target, options) => options.method === 'POST'
      ? {status: 200, headers: {}, text: '{"event_id":"event-1"}'}
      : {status: 200, headers: {}, text: working},
  });

  const result = await invokeNormalizedConnector(provider, config, {message: 'fixture'});
  assert.equal(result.outcome, 'unobserved_response');
  assert.equal(result.completed, true);
  assert.equal(result.response, null);
  assert.deepEqual(result.diagnostics, {stage: 'output', code: 'progress_placeholder', stepIndex: 0});
});

test('named Gradio error events remain terminal even after a provisional progress snapshot', () => {
  const stream = completion('_Working..._') + 'event: error\ndata: upstream failed\n\n';
  assert.equal(hasNamedCallTerminalEvent(stream), true);
  assert.throws(() => parseSseComplete(stream));
});
