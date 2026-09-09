import test from 'node:test';
import assert from 'node:assert/strict';
import {executeGradioPlan, parsePlan} from '../lib/server/gradio-workflow.ts';
import {PinnedRequestTimeoutError} from '../lib/server/pinned-https.ts';
import {GradioInvocationError} from '../lib/server/gradio-errors.ts';
const target = {url: new URL('https://example.com'), hostname: 'example.com', address: '93.184.216.34', family: 4 as const};

// Travel Agent /gradio_api/info: four Textboxes -> one Markdown output.
// Live Gradio 6.20.0 emits heartbeat events while plan_trip is still running.
test('structured Gradio polling can complete after 18 seconds within the existing workflow budget', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const plan = parsePlan('["London","Paris","October","{{message}}"]', 'plan_trip', '0');
  const result = await executeGradioPlan(target, plan, 'fixture', async (url, options) => {
    if (options.method === 'POST') {
      assert.deepEqual(JSON.parse(options.body!).data, ['London', 'Paris', 'October', 'fixture']);
      assert.equal(options.timeoutMs, 18000);
      now += 1000;
      return {status: 200, headers: {}, text: '{"event_id":"travel-event"}'};
    }
    assert.equal(url.url.pathname, '/gradio_api/call/plan_trip/travel-event');
    assert.equal(options.timeoutMs, 44000, 'poll must use the remaining total budget');
    now += 24000;
    return {status: 200, headers: {}, text: 'event: heartbeat\ndata: null\n\nevent: complete\ndata: ["Trip fixture"]\n\n'};
  });
  assert.deepEqual(result, ['Trip fixture']);
});

test('shared-session steps consume one deadline; heartbeats and partial output are not completion', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const plan = parsePlan(JSON.stringify({steps: [{apiName: 'prepare', inputs: ['{{message}}']}, {apiName: 'answer', inputs: ['{{step0}}']}]}), '', '0');
  let polls = 0;
  await assert.rejects(executeGradioPlan(target, plan, 'fixture', async (url, options) => {
    if (options.method === 'POST') {
      now += 1000;
      return {status: 200, headers: {}, text: '{"event_id":"ours"}'};
    }
    assert.equal(url.url.pathname, '/gradio_api/queue/data');
    assert.equal(options.timeoutMs, polls === 0 ? 44000 : 19000);
    now += polls === 0 ? 24000 : 1000;
    return {status: 200, headers: {}, text: ++polls === 1
      ? 'data: {"msg":"process_completed","event_id":"ours","success":true,"output":{"data":["state"]}}\n\n'
      : 'data: {"msg":"heartbeat"}\n\ndata: {"msg":"process_generating","event_id":"ours","output":{"data":["partial"]}}\n\n'};
  }), e => e instanceof GradioInvocationError && e.code === 'incomplete_stream');
});

test('only trusted local deadline errors become timeout diagnostics; remote text cannot classify them', async () => {
  for (const [error, code] of [[new PinnedRequestTimeoutError(), 'timeout'], [new Error('Upstream request deadline exceeded.'), 'transport']] as const) {
    await assert.rejects(executeGradioPlan(target, parsePlan('["{{message}}"]', 'chat', '0'), 'fixture', async (_url, options) => {
      if (options.method === 'POST') return {status: 200, headers: {}, text: '{"event_id":"ours"}'};
      throw error;
    }), e => e instanceof GradioInvocationError && e.stage === 'poll' && e.code === code && e.stepIndex === 0);
  }
});

test('a depleted shared workflow deadline prevents another submit', async t => {
  let now = 1000, submits = 0;
  t.mock.method(Date, 'now', () => now);
  const plan = parsePlan(JSON.stringify({steps: [{apiName: 'prepare', inputs: ['{{message}}']}, {apiName: 'answer', inputs: ['{{step0}}']}]}), '', '0');
  await assert.rejects(executeGradioPlan(target, plan, 'fixture', async (_url, options) => {
    if (options.method === 'POST') {submits++; return {status: 200, headers: {}, text: '{"event_id":"ours"}'};}
    now += 45000;
    return {status: 200, headers: {}, text: 'data: {"msg":"process_completed","event_id":"ours","success":true,"output":{"data":["state"]}}\n\n'};
  }), e => e instanceof GradioInvocationError && e.stage === 'submit' && e.code === 'timeout');
  assert.equal(submits, 1);
});
