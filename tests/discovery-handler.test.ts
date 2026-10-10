import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscoveryHandler} from '../lib/server/connectors/discovery-handler.ts';
import {gradioRecipeFields} from '../lib/connectors/recipe-form.ts';
function request(body: unknown, origin: string | null = 'https://benchrx.example') {
  return new Request('https://benchrx.example/api/connections/discover', {method: 'POST', headers: origin ? {Origin: origin} : {}, body: JSON.stringify(body)});
}
test('discovery requires same origin, not operator auth, and does not leak errors', async () => {
  let calls = 0;
  const handler = createDiscoveryHandler(async () => {calls++; throw new Error('https://secret:password@private/ raw diagnostic');});
  assert.equal((await handler(request({spaceUrl: 'https://demo.hf.space'}, null))).status, 403);
  assert.equal((await handler(request({spaceUrl: 'https://demo.hf.space'}, 'https://evil.example'))).status, 403);
  assert.equal(calls, 0);
  const response = await handler(request({spaceUrl: 'https://demo.hf.space'}));
  assert.equal(response.status, 422); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('www-authenticate'), null);
  assert.equal(calls, 1);
  assert.equal((await response.text()).includes('password'), false);
});
test('same-origin discovery succeeds without credentials and never requests Basic Auth', async () => {
  const handler = createDiscoveryHandler(async () => ({provider: 'gradio', status: 'manual_required', message: 'Manual', recipes: []}));
  const response = await handler(request({spaceUrl: 'https://demo.hf.space'}));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('www-authenticate'), null);
  assert.equal((await response.json()).provider, 'gradio');
});
test('discovery bounds input size and concurrent work while manual endpoints stay independent', async () => {
  const releases: (() => void)[] = [];
  const handler = createDiscoveryHandler(async () => {await new Promise<void>(r => releases.push(r)); return {provider: 'gradio', status: 'manual_required', message: 'Manual', recipes: []};});
  assert.equal((await handler(request({spaceUrl: 'x'.repeat(5000)}))).status, 422);
  const first = handler(request({spaceUrl: 'https://demo.hf.space'}));
  const second = handler(request({spaceUrl: 'https://demo.hf.space'}));
  assert.equal((await handler(request({spaceUrl: 'https://demo.hf.space'}))).status, 429);
  await new Promise(r => setTimeout(r, 0)); releases.forEach(r => r());
  assert.equal((await first).status, 200); assert.equal((await second).status, 200);
});
test('applying a recipe preserves workflow JSON and only fills existing connector fields', () => {
  const inputs = '{"steps":[{"apiName":"log_user_message","inputs":["{{message}}"]},{"apiName":"interact_with_agent","inputs":["{{step0.outputs.1}}"]}]}';
  const fields = gradioRecipeFields({provider: 'gradio', label: 'fixture', config: {space: 'https://demo.hf.space', apiName: 'interact_with_agent', inputs, outputIndex: '0', Authorization: 'must-not-copy'}});
  assert.deepEqual(fields, {spaceUrl: 'https://demo.hf.space', apiName: 'interact_with_agent', gradioInputs: inputs, outputIndex: '0'});
  assert.equal('Authorization' in fields, false);
});
