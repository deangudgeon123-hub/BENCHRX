import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscoveryHandler} from '../lib/server/connectors/discovery-handler.ts';
import {gradioRecipeFields} from '../lib/connectors/recipe-form.ts';
const token = 'fixture-operator-secret'.repeat(3);
function request(body: unknown, auth = true, origin = 'https://benchrx.example') {
  return new Request('https://benchrx.example/api/connections/discover', {method: 'POST', headers: {Origin: origin, ...(auth ? {Authorization: 'Basic ' + Buffer.from('benchrx:' + token).toString('base64')} : {})}, body: JSON.stringify(body)});
}
test('discovery authenticates and checks origin before network work, and does not leak errors', async () => {
  process.env.BENCHRX_ADMIN_TOKEN = token;
  let calls = 0;
  const handler = createDiscoveryHandler(async () => {calls++; throw new Error('https://secret:password@private/ raw diagnostic');});
  assert.equal((await handler(request({spaceUrl: 'https://demo.hf.space'}, false))).status, 401);
  assert.equal((await handler(request({spaceUrl: 'https://demo.hf.space'}, true, 'https://evil.example'))).status, 403);
  assert.equal(calls, 0);
  const response = await handler(request({spaceUrl: 'https://demo.hf.space'}));
  assert.equal(response.status, 422); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.text()).includes('password'), false);
  delete process.env.BENCHRX_ADMIN_TOKEN;
});
test('discovery bounds input size and concurrent work while manual endpoints stay independent', async () => {
  process.env.BENCHRX_ADMIN_TOKEN = token;
  const releases: (() => void)[] = [];
  const handler = createDiscoveryHandler(async () => {await new Promise<void>(r => releases.push(r)); return {provider: 'gradio', status: 'manual_required', message: 'Manual', recipes: []};});
  assert.equal((await handler(request({spaceUrl: 'x'.repeat(5000)}))).status, 422);
  const first = handler(request({spaceUrl: 'https://demo.hf.space'}));
  const second = handler(request({spaceUrl: 'https://demo.hf.space'}));
  assert.equal((await handler(request({spaceUrl: 'https://demo.hf.space'}))).status, 429);
  await new Promise(r => setTimeout(r, 0)); releases.forEach(r => r());
  assert.equal((await first).status, 200); assert.equal((await second).status, 200);
  delete process.env.BENCHRX_ADMIN_TOKEN;
});
test('applying a recipe preserves workflow JSON and only fills existing connector fields', () => {
  const inputs = '{"steps":[{"apiName":"log_user_message","inputs":["{{message}}"]},{"apiName":"interact_with_agent","inputs":["{{step0.outputs.1}}"]}]}';
  const fields = gradioRecipeFields({provider: 'gradio', label: 'fixture', config: {space: 'https://demo.hf.space', apiName: 'interact_with_agent', inputs, outputIndex: '0', Authorization: 'must-not-copy'}});
  assert.deepEqual(fields, {spaceUrl: 'https://demo.hf.space', apiName: 'interact_with_agent', gradioInputs: inputs, outputIndex: '0'});
  assert.equal('Authorization' in fields, false);
});
