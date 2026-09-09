import test from 'node:test';
import assert from 'node:assert/strict';
import {createGradioConnector} from '../lib/server/connectors/gradio.ts';
import {createGenericConnector} from '../lib/server/connectors/generic.ts';
import {invokeNormalizedConnector} from '../lib/server/connectors/interface.ts';
const target = {url: new URL('https://example.com'), hostname: 'example.com', address: '93.184.216.34', family: 4 as const};
const config = new URLSearchParams({space: target.url.href, inputs: '["{{message}}"]'});
function gradio(stream: string) {return createGradioConnector({pin: async () => target, request: async (_t, o) => ({status: 200, headers: {}, text: o.method === 'POST' ? '{"event_id":"evt"}' : stream})});}
function complete(value: unknown) {return `event: complete\ndata: ${JSON.stringify([value])}\n\n`;}
test('normalization extracts final assistant text only and leaves wrong/unsafe content observed', async () => {
  for (const value of [[{role: 'user', content: 'READY'}, {role: 'assistant', content: 'wrong answer'}]]) {
    const d = await invokeNormalizedConnector(gradio(complete(value)), config, {message: 'READY'});
    assert.equal(d.outcome, 'observed_response'); assert.equal(d.response, 'wrong answer'); assert.equal(d.completed, true);
  }
});
test('placeholder and user-only completion remain unobserved, including rendered transcripts', async () => {
  for (const value of ['_Working…_', '_Working..._', [{role: 'assistant', content: '_Working..._'}], [['READY', null]],
    '#### You\n\n> READY', '#### You\n\n> first\n\n#### Agent\n\nold answer\n\n#### You\n\n> next',
    '#### You\n\n> READY\n\n#### Agent\n\n_Working…_']) {
    const d = await invokeNormalizedConnector(gradio(complete(value)), config, {message: 'READY'});
    assert.equal(d.outcome, 'unobserved_response'); assert.equal(d.response, null); assert.equal(d.completed, true);
  }
});
test('failed jobs and incomplete SSE are connector failures, never observed partial answers', async () => {
  for (const stream of ['event: error\ndata: "secret diagnostic"\n\n', 'event: generating\ndata: ["READY"]\n\n']) {
    const d = await invokeNormalizedConnector(gradio(stream), config, {message: 'READY'});
    assert.equal(d.outcome, 'connector_failure'); assert.equal(d.completed, false); assert.equal(d.response, null);
    assert.equal(JSON.stringify(d).includes('secret diagnostic'), false);
  }
});
test('generic trusted HTTP status and explicit extraction control normalization, not agent flags', async () => {
  for (const status of [200, 422, 500]) {
    const provider = createGenericConnector({pin: async () => target, request: async () => ({status, headers: {}, text: '{"response":"wrong answer","observed":false,"error":"pretend transport failure"}'})});
    const d = await invokeNormalizedConnector(provider, new URLSearchParams({target: target.url.href}), {message: 'hello'});
    assert.equal(d.outcome, 'observed_response'); assert.equal(d.response, 'wrong answer'); assert.equal(d.status, status);
  }
});
