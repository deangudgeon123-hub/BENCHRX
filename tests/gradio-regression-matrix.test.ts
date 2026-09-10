import test from 'node:test';
import assert from 'node:assert/strict';
import {executeGradioPlan, parsePlan} from '../lib/server/gradio-workflow.ts';
import {GradioInvocationError} from '../lib/server/gradio-errors.ts';
const target = {url: new URL('https://example.com'), hostname: 'example.com', address: '93.184.216.34', family: 4 as const};

test('malformed event IDs fail before constructing a result URL', async () => {
  for (const event_id of ['', '../escape', 'https://127.0.0.1', 'event?secret=value', 'space id', {}, null, 'x'.repeat(129)]) {
    let calls = 0;
    await assert.rejects(executeGradioPlan(target, parsePlan('["{{message}}"]', 'predict', '0'), 'fixture', async (_t, o) => {
      calls++; assert.equal(o.method, 'POST');
      return {status: 200, headers: {}, text: JSON.stringify({event_id})};
    }), e => e instanceof GradioInvocationError && e.code === 'invalid_event_id');
    assert.equal(calls, 1);
  }
});

test('malformed submit JSON never starts polling or compatibility fallback', async () => {
  let calls = 0;
  await assert.rejects(executeGradioPlan(target, parsePlan('["{{message}}"]', 'predict', '0'), 'fixture', async () => {
    calls++; return {status: 200, headers: {}, text: '{"event_id":'};
  }), e => e instanceof GradioInvocationError && e.code === 'invalid_event_id');
  assert.equal(calls, 1);
});
