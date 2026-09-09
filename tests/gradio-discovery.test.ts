import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverGradio, parseGradioSchema, singleStepRecipes} from '../lib/server/connectors/gradio-discovery.ts';
import type {ConnectorIO} from '../lib/server/connectors/interface.ts';
const param = (name: string, type = 'string', component = 'Textbox') => ({parameter_name: name, type: {type}, component});
const endpoint = {parameters: [param('message')], returns: [param('answer')]};
const schema = {named_endpoints: {'/chat': endpoint}};
function ioFor(body: unknown): ConnectorIO {
  return {pin: async raw => ({url: new URL(raw), hostname: new URL(raw).hostname, address: '93.184.216.34', family: 4}), request: async (t, o) => {
    assert.equal(o.method, 'GET'); assert.equal(o.headers?.Authorization, undefined);
    assert.equal(t.url.pathname, '/gradio_api/info'); assert.equal(o.maxResponseBytes, 1000000);
    return {status: 200, headers: {}, text: JSON.stringify(body)};
  }};
}
test('single-step discovery proposes the existing manual recipe format without invoking an agent', async () => {
  const d = await discoverGradio('https://demo.hf.space/', ioFor(schema));
  assert.equal(d.status, 'proposed'); assert.deepEqual(d.recipes[0].config, {space: 'https://demo.hf.space', apiName: 'chat', inputs: '["{{message}}"]', outputIndex: '0'});
  assert.equal(d.endpoints[0].inputCount, 1); assert.equal(d.endpoints[0].outputs[0].type, 'string');
});
test('ambiguous endpoints require a choice; unknown parameters require manual configuration', async () => {
  const d = await discoverGradio('https://demo.hf.space', ioFor({named_endpoints: {'/chat': endpoint, '/agent': endpoint}}));
  assert.equal(d.status, 'ambiguous'); assert.equal(d.recipes.length, 2);
  const unknown = parseGradioSchema({named_endpoints: {'/chat': {...endpoint, parameters: [param('message'), param('secret')]}}});
  assert.deepEqual(singleStepRecipes('https://demo.hf.space', unknown), []);
});
test('discovery does not expose schema examples, descriptions or string defaults', async () => {
  const d = await discoverGradio('https://demo.hf.space', ioFor({named_endpoints: {'/chat': {...endpoint, description: 'secret-value', parameters: [param('message'), {...param('api_key'), parameter_has_default: true, parameter_default: 'secret-value'}]}}}));
  assert.equal(JSON.stringify(d).includes('secret-value'), false); assert.equal(d.status, 'manual_required');
});
test('discovery pins both HF metadata and resolved Space, follows no redirects and rejects query configuration', async () => {
  const pinned: string[] = [];
  const io = ioFor(schema), originalPin = io.pin;
  io.pin = async (raw, options) => {pinned.push(raw); return originalPin(raw, options);};
  const originalRequest = io.request;
  io.request = async (t, o) => t.url.pathname.startsWith('/api/spaces/') ? {status: 200, headers: {}, text: '{"sdk":"gradio","host":"https://resolved.hf.space"}'} : originalRequest(t, o);
  const d = await discoverGradio('https://huggingface.co/spaces/owner/app', io);
  assert.equal(d.spaceUrl, 'https://resolved.hf.space'); assert.equal(pinned.length, 2);
  await assert.rejects(discoverGradio('https://demo.hf.space?token=secret', io));
  await assert.rejects(discoverGradio('https://demo.hf.space', {...io, request: async () => ({status: 302, headers: {location: 'https://127.0.0.1'}, text: ''})}));
});
