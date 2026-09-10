import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverGradio} from '../lib/server/connectors/gradio-discovery.ts';
const p = (name: string, type = 'string', component = 'Textbox') => ({parameter_name: name, type: {type}, component, parameter_has_default: false});
const discover = (parameters: unknown[], returns: unknown[] = [p('answer')], apiName = 'generate') => discoverGradio('https://demo.hf.space', {
  pin: async raw => ({url: new URL(raw), hostname: 'demo.hf.space', address: '93.184.216.34', family: 4}),
  request: async () => ({status: 200, headers: {}, text: JSON.stringify({named_endpoints: {[`/${apiName}`]: {parameters, returns}}})}),
});

test('required image endpoints are recognized but never proposed as automatic text benchmarks', async () => {
  const d = await discover([p('image', 'object', 'Image'), p('prompt'), p('max_new_tokens', 'number', 'Slider'), p('temperature', 'number', 'Slider'), p('top_p', 'number', 'Slider')]);
  assert.equal(d.endpoints.length, 1); assert.equal(d.endpoints[0].inputCount, 5);
  assert.equal(d.endpoints[0].capabilities.invocation, 'requires_inputs');
  assert.equal(d.endpoints[0].capabilities.textSuite, 'unsupported_inputs');
  assert.equal(d.endpoints[0].capabilities.reason, 'requires_media_fixture');
  assert.equal(d.status, 'manual_required'); assert.deepEqual(d.recipes, []);
});

test('zero-input/output login helpers never become benchmark recipes', async () => {
  const d = await discover([], [], '_check_login_status');
  assert.equal(d.endpoints.length, 1); assert.equal(d.endpoints[0].capabilities.textSuite, 'no_text_interface');
  assert.deepEqual(d.recipes, []);
});

test('text interface candidates and structured templates distinguish mapping from invocation proof', async () => {
  const simple = await discover([p('question')], [p('answer')], 'predict');
  assert.equal(simple.endpoints[0].capabilities.invocation, 'recipe_available');
  assert.equal(simple.endpoints[0].capabilities.textSuite, 'text_candidate');
  const structured = await discover([p('question'), p('option_a')], [p('answer')], 'solve_mcq');
  assert.equal(structured.endpoints[0].capabilities.invocation, 'requires_inputs');
  assert.equal(structured.endpoints[0].capabilities.textSuite, 'requires_fixed_inputs');
  assert.equal(structured.recipes[0].kind, 'template');
  const ambiguous = await discover([p('prompt'), p('context')]);
  assert.equal(ambiguous.endpoints[0].capabilities.reason, 'message_mapping_unproven');
});
