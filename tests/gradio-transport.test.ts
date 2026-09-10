import test from 'node:test';
import assert from 'node:assert/strict';
import {namedCallCapability, queueCallCapability} from '../lib/server/connectors/gradio-transport.ts';
import {executeGradioPlan, parsePlan} from '../lib/server/gradio-workflow.ts';
import {GradioInvocationError} from '../lib/server/gradio-errors.ts';
const target = {url: new URL('https://example.com'), hostname: 'example.com', address: '93.184.216.34', family: 4 as const};
const endpoint = {api_visibility: 'public', parameters: [{parameter_name: 'question'}], returns: []};
const info = {named_endpoints: {'/ask': endpoint}};
const config = {api_prefix: '/gradio_api', enable_queue: true, protocol: 'sse_v3', dependencies: [{id: 3, api_name: 'ask', api_visibility: 'public', queue: true, inputs: [0], outputs: [1]}]};
const named = {...info, named_endpoints: {'/ask': {...endpoint, code_snippets: {bash: 'curl http://0.0.0.0:7860/gradio_api/call/v2/ask'}}}};

test('transport capabilities require explicit public evidence, not guessed versions or dependency IDs alone', () => {
  assert.equal(queueCallCapability(info, config, 'ask', 1), 3);
  assert.deepEqual(namedCallCapability(named, 'ask', 1), ['question']);
  assert.equal(namedCallCapability({...info, version: '6.20.0'}, 'ask', 1), null);
  assert.equal(queueCallCapability(info, {...config, api_prefix: 'https://127.0.0.1'}, 'ask', 1), null);
  for (const d of [{...config.dependencies[0], api_visibility: 'private'}, {...config.dependencies[0], queue: false}, {...config.dependencies[0], inputs: [0, 1]}]) {
    assert.equal(queueCallCapability(info, {...config, dependencies: [d]}, 'ask', 1), null);
  }
  assert.equal(queueCallCapability(info, {...config, dependencies: [...config.dependencies, ...config.dependencies]}, 'ask', 1), null);
  assert.equal(namedCallCapability({named_endpoints: {'/ask': {...named.named_endpoints['/ask'], parameters: [{parameter_name: '__proto__'}]}}}, 'ask', 1), null);
});

test('ordinary HTTP errors and redirects never trigger alternate submission', async () => {
  for (const status of [401, 403, 429, 500, 502, 302]) {
    let count = 0;
    await assert.rejects(executeGradioPlan(target, parsePlan('["{{message}}"]', 'ask', '0'), 'fixture', async () => {
      count++; return {status, headers: {}, text: ''};
    }), e => e instanceof GradioInvocationError && e.httpStatus === status);
    assert.equal(count, 1);
  }
});

test('a failed evidence-selected alternative does not trigger queue retry or duplicate execution', async () => {
  for (const status of [404, 500]) {
    const calls: string[] = [];
    await assert.rejects(executeGradioPlan(target, parsePlan('["{{message}}"]', 'ask', '0'), 'fixture', async (t, o) => {
      calls.push(o.method + ' ' + t.url.pathname);
      assert.equal(t.url.origin, target.url.origin); assert.equal(t.address, target.address);
      if (o.method === 'GET') return {status: 200, headers: {}, text: JSON.stringify(named)};
      return {status: calls.length === 1 ? 404 : status, headers: {}, text: ''};
    }), e => e instanceof GradioInvocationError && e.httpStatus === status);
    assert.deepEqual(calls, ['POST /gradio_api/call/ask', 'GET /gradio_api/info', 'POST /gradio_api/call/v2/ask']);
  }
});

test('an upstream 404 without matching public capabilities is not a compatibility fallback signal', async () => {
  let posts = 0;
  await assert.rejects(executeGradioPlan(target, parsePlan('["{{message}}"]', 'ask', '0'), 'fixture', async (_t, o) => {
    if (o.method === 'POST') {posts++; return {status: 404, headers: {}, text: ''};}
    return {status: 200, headers: {}, text: '{"version":"6.0.0","named_endpoints":{},"dependencies":[]}'};
  }), e => e instanceof GradioInvocationError && e.httpStatus === 404);
  assert.equal(posts, 1);
});
