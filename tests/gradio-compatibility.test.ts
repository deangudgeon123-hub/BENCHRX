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

test('final compatibility matrix keeps supported, structured, media, and task-specific endpoints separated', async () => {
  const simple = await discover([p('message')], [p('answer')], 'chat');
  assert.equal(simple.status, 'proposed');
  assert.equal(simple.recipes[0].kind, 'executable');
  assert.equal(simple.endpoints[0].capabilities.reason, 'text_interface_candidate');

  const bella = await discover(
    [p('message', 'string', 'api'), p('history', 'array', 'api')],
    [p('1st', 'string', 'api'), p('2nd', 'array', 'api')],
    'chat',
  );
  assert.equal(bella.status, 'proposed');
  assert.equal(bella.recipes[0].kind, 'template');
  assert.deepEqual(JSON.parse(bella.recipes[0].config.inputs), ['{{message}}', '<REQUIRED:history>']);
  assert.equal(bella.endpoints[0].capabilities.reason, 'operator_values_required');

  const mcq = await discover(
    ['question', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e'].map(name => p(name)),
    [p('answer')],
    'solve_mcq',
  );
  assert.equal(mcq.status, 'proposed');
  assert.equal(mcq.recipes[0].kind, 'template');
  assert.equal(mcq.endpoints[0].capabilities.reason, 'operator_values_required');

  const media = await discover(
    [p('image', 'object', 'Image'), p('prompt')],
    [p('response')],
    'generate',
  );
  assert.equal(media.status, 'manual_required');
  assert.equal(media.endpoints[0].capabilities.reason, 'requires_media_fixture');
  assert.deepEqual(media.recipes, []);

  const targetLanguage = {...p('target_language', 'string', 'Dropdown'), parameter_has_default: true, parameter_default: 'JavaScript'};
  const codeTool = await discover(
    [p('python_code', 'string', 'Code'), targetLanguage],
    [p('Python Code', 'string', 'Code'), p('Translated Code', 'string', 'Code'), p('Python Execution Result'), p('Translated Code Execution Result')],
    'process_code',
  );
  assert.equal(codeTool.status, 'manual_required');
  assert.equal(codeTool.endpoints[0].capabilities.reason, 'message_mapping_unproven');
  assert.deepEqual(codeTool.recipes, []);
});
