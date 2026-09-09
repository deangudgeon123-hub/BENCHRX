import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenericConnector} from '../lib/server/connectors/generic.ts';
import {createGradioConnector} from '../lib/server/connectors/gradio.ts';
import {invokeConnector, type ConnectorIO} from '../lib/server/connectors/interface.ts';
const target = {url: new URL('https://example.com'), hostname: 'example.com', address: '93.184.216.34', family: 4 as const};
const pin: ConnectorIO['pin'] = async () => target;

test('manual generic paths, fixed body and observed non-2xx response remain compatible', async () => {
  const bodies: unknown[] = [];
  const provider = createGenericConnector({pin, request: async (t, o) => {
    assert.equal(t.address, target.address); bodies.push(JSON.parse(o.body!));
    return {status: 422, headers: {}, text: '{"answer":{"text":" wrong but observed "}}'};
  }});
  const config = new URLSearchParams({target: target.url.href, requestPath: 'messages[0].content', responsePath: 'answer.text', fixedBody: '{"model":"fixture"}'});
  assert.deepEqual(await invokeConnector(provider, config, {message: 'hello'}), {status: 422, body: {response: 'wrong but observed', provider: 'generic'}});
  assert.deepEqual(bodies[0], {model: 'fixture', messages: [{content: 'hello'}]});
  await invokeConnector(provider, config, {});
  assert.deepEqual(bodies[1], {model: 'fixture'});
});

test('manual Frontier configuration and single-step Gradio preserve selected output', async () => {
  for (const outputIndex of ['0', '3']) {
    const provider = createGradioConnector({pin, request: async (_t, o) => {
      if (o.method === 'POST') {assert.deepEqual(JSON.parse(o.body!).data, ['hello']); return {status: 200, headers: {}, text: '{"event_id":"event-1"}'};}
      const outputs = outputIndex === '3' ? [null, null, null, '#### You\n\n> hello\n\n#### FrontierAgent\n\nAnswer'] : ['Answer'];
      return {status: 200, headers: {}, text: `event: complete\ndata: ${JSON.stringify(outputs)}\n\n`};
    }});
    const reply = await invokeConnector(provider, new URLSearchParams({space: target.url.href, apiName: '_run', inputs: '["{{message}}"]', outputIndex}), {message: 'hello'});
    assert.equal(reply.status, 200); assert.equal(reply.body.response, 'Answer');
    assert.equal(reply.body.apiName, '_run'); assert.equal(reply.body.workflowSteps, 1);
  }
});

test('generic redirect and missing extraction stay connector errors; unsafe mapping fails before invocation', async () => {
  for (const status of [200, 302, 401]) {
    const provider = createGenericConnector({pin, request: async () => ({status, headers: {}, text: '{}'})});
    const config = new URLSearchParams({target: target.url.href});
    const reply = await invokeConnector(provider, config, {message: 'hello'});
    assert.equal(reply.status, status === 401 ? 401 : 502); assert.equal(reply.body.response, undefined);
    config.set('requestPath', '__proto__.polluted');
    assert.equal((await invokeConnector(provider, config, {message: 'hello'})).status, 502);
  }
});
