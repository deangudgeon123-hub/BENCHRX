import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGradioSchema, singleStepRecipes} from '../lib/server/connectors/gradio-discovery.ts';
import {enrichSchemaGraph} from '../lib/server/connectors/gradio-schema.ts';

const p = (name: string, type = 'string', component = 'Textbox') => ({parameter_name: name, type: {type}, component});
const parse = (parameters: unknown[], returns: unknown[] = [p('answer')]) => parseGradioSchema({named_endpoints: {'/predict': {parameters, returns}}});

test('normalized parameters distinguish absent, redacted and declared safe defaults', () => {
  const e = parse([p('prompt'), {...p('model', 'string', 'Dropdown'), parameter_has_default: true, parameter_default: 'public-model'},
    {...p('api_key'), parameter_has_default: true, parameter_default: 'private-secret'},
    {...p('temperature', 'number', 'Slider'), parameter_has_default: false}])[0];
  assert.equal(e.inputCount, 4);
  assert.equal(e.inputs[0].required, null);
  assert.equal(e.inputs[1].defaultSafety, 'safe'); assert.equal(e.inputs[1].defaultValue, 'public-model');
  assert.equal(e.inputs[2].required, false); assert.equal(e.inputs[2].declaredDefault, true);
  assert.equal(e.inputs[2].defaultSafety, 'redacted'); assert.equal(Object.hasOwn(e.inputs[2], 'defaultValue'), false);
  assert.equal(e.inputs[3].required, true);
  assert.equal(JSON.stringify(e).includes('private-secret'), false);
});

test('schema capabilities remain evidence candidates, not an invocation success claim', () => {
  const e = parse([p('message'), p('history', 'array', 'State'), p('image', 'object', 'Image')],
    [p('status'), p('files', 'array', 'File'), p('conversation', 'array', 'Chatbot')])[0];
  assert.equal(e.outputCount, 3);
  assert.deepEqual(e.capabilities.textInputCandidates, [0]);
  assert.deepEqual(e.capabilities.structuredInputCandidates, [2]);
  assert.deepEqual(e.capabilities.assistantOutputCandidates, [0, 2]);
  assert.equal(e.capabilities.invocation, 'unverified'); assert.equal(e.capabilities.textSuite, 'unverified');
  assert.equal(e.inputs[1].state, true); assert.equal(e.inputs[1].hidden, true);
});

test('graph normalization retains hidden State wire positions without changing visible counts', () => {
  const endpoints = parse([p('prompt')], [p('status'), p('answer')]);
  const config = {components: [{id: 1, type: 'state'}, {id: 2, type: 'textbox'}, {id: 3, type: 'markdown'}, {id: 4, type: 'markdown', props: {visible: false}}],
    dependencies: [{id: 9, api_name: 'predict', inputs: [1, 2], outputs: [3, 1, 4], trigger_after: 8}]};
  const [e] = enrichSchemaGraph(endpoints, config);
  assert.equal(e.inputCount, 1); assert.equal(e.outputCount, 2);
  assert.equal(e.inputs[0].wireIndex, 1); assert.equal(e.outputs[1].wireIndex, 2);
  assert.equal(e.outputs[1].hidden, true); assert.equal(e.outputs[1].state, false);
  assert.equal(e.dependency?.inputs[0].state, true); assert.equal(e.dependency?.triggerAfter, 8);
  assert.equal(e.capabilities.workflow, 'shared_state_required');
  const [recipe] = singleStepRecipes('https://demo.hf.space', [e]);
  assert.deepEqual(JSON.parse(recipe.config.inputs), [null, '{{message}}']);
  assert.equal(recipe.config.outputIndex, '2');
  assert.equal(singleStepRecipes('https://demo.hf.space', endpoints)[0].config.outputIndex, '1');
  assert.deepEqual(enrichSchemaGraph(endpoints, {...config, components: [...config.components, config.components[0]]}), endpoints);
  assert.deepEqual(enrichSchemaGraph(endpoints, {...config, components: []}), endpoints);
});

test('malformed or oversized endpoint schemas do not produce capabilities or expose descriptions/examples', () => {
  for (const raw of [null, [], {named_endpoints: {'/bad/path': {parameters: [], returns: []}}}, {named_endpoints: {'/chat': {parameters: {}, returns: []}}}]) assert.deepEqual(parseGradioSchema(raw), []);
  const [e] = parse([{...p('message'), description: 'private', example_input: 'private', type: {type: 'string', examples: ['private']}}]);
  assert.equal(JSON.stringify(e).includes('private'), false);
  assert.deepEqual(parse(Array.from({length: 33}, () => p('message'))), []);
});
