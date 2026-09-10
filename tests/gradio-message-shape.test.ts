import test from 'node:test';
import assert from 'node:assert/strict';
import {provenMessageShape} from '../lib/server/connectors/gradio-message-shape.ts';
import {parseGradioSchema, singleStepRecipes, structuredInputRecipes} from '../lib/server/connectors/gradio-discovery.ts';
import {parsePlan, executeGradioPlan} from '../lib/server/gradio-workflow.ts';
const message = {parameter_name: 'message', component: 'Multimodaltextbox', type: {
  type: 'object', title: 'MultimodalData', properties: {text: {type: 'string'}, files: {type: 'array', items: {$ref: '#/$defs/FileData'}}}, required: ['text'],
}};
const nullableMessage = {parameter_name: 'message', component: 'Multimodaltextbox', type: {
  type: 'object', title: 'MultimodalData', properties: {
    text: {anyOf: [{type: 'string'}, {type: 'null'}], default: null},
    files: {type: 'array', items: {$ref: '#/$defs/FileData'}, default: []},
  }, required: ['text'],
}};
const scalar = (name: string, type = 'string') => ({parameter_name: name, type: {type}, component: type === 'string' ? 'Textbox' : 'Slider'});
const parse = (parameters: unknown[]) => parseGradioSchema({named_endpoints: {'/chat': {parameters, returns: [scalar('answer')]}}});

test('proven MultimodalData generates text-only objects without inventing other fixed values', () => {
  assert.equal(provenMessageShape(message), 'text_files');
  const [recipe] = structuredInputRecipes('https://demo.hf.space', parse([message, scalar('param_2'), scalar('param_3', 'number')]));
  assert.equal(recipe.kind, 'template');
  assert.deepEqual(JSON.parse(recipe.config.inputs), [{text: '{{message}}', files: []}, '<REQUIRED:param_2>', '<REQUIRED:param_3>']);
  assert.equal(JSON.stringify(parse([{...message, type: {...message.type, $defs: {FileData: {description: 'not-public-in-discovery'}}}}])).includes('not-public-in-discovery'), false);
  const [liveLike] = structuredInputRecipes('https://demo.hf.space', parse([message,
    {...scalar('param_2'), parameter_has_default: true, parameter_default: 'private system instructions'},
    {...scalar('param_3', 'number'), label: 'Max new tokens', parameter_has_default: true, parameter_default: 512}]));
  assert.deepEqual(JSON.parse(liveLike.config.inputs), [{text: '{{message}}', files: []}, '<REQUIRED:param_2>', 512]);
  assert.equal(JSON.stringify(liveLike).includes('private system instructions'), false);
});

test('Gradio 5 nullable MultimodalTextbox schemas remain proven text-only messages', () => {
  assert.equal(provenMessageShape(nullableMessage), 'text_files');
  const [recipe] = structuredInputRecipes('https://demo.hf.space', parse([
    nullableMessage,
    {...scalar('system_prompt'), label: 'System Prompt', parameter_has_default: true, parameter_default: ''},
    {...scalar('max_new_tokens', 'number'), label: 'Max New Tokens', parameter_has_default: true, parameter_default: 2048},
  ]));
  assert.equal(recipe.kind, 'executable');
  assert.deepEqual(JSON.parse(recipe.config.inputs), [{text: '{{message}}', files: []}, '', 2048]);
});

test('unknown objects, required uploads and extra constraints remain manual', () => {
  for (const candidate of [{...message, component: 'JSON'}, {...message, type: {type: 'object'}},
    {...message, type: {...message.type, required: ['text', 'image']}},
    {...message, type: {...message.type, properties: {...message.type.properties, files: {type: 'array', minItems: 1}}}},
    {...message, type: {...message.type, allOf: [{required: ['secret']}]}}]) {
    assert.equal(provenMessageShape(candidate), null);
    assert.deepEqual(singleStepRecipes('https://demo.hf.space', parse([candidate])), []);
  }
  assert.equal(provenMessageShape({...nullableMessage, type: {...nullableMessage.type, properties: {
    ...nullableMessage.type.properties,
    text: {anyOf: [{type: 'string'}, {type: 'number'}, {type: 'null'}]},
  }}}), null);
});

test('proven object messages invoke through unchanged Gradio transport and string inputs stay strings', async () => {
  const [recipe] = singleStepRecipes('https://demo.hf.space', parse([message]));
  const target = {url: new URL('https://demo.hf.space'), hostname: 'demo.hf.space', address: '93.184.216.34', family: 4 as const};
  const result = await executeGradioPlan(target, parsePlan(recipe.config.inputs, 'chat', '0'), 'fixture', async (_t, o) => {
    if (o.method === 'POST') {
      assert.deepEqual(JSON.parse(o.body!).data, [{text: 'fixture', files: []}]);
      return {status: 200, headers: {}, text: '{"event_id":"object-event"}'};
    }
    return {status: 200, headers: {}, text: 'event: complete\ndata: ["assistant fixture"]\n\n'};
  });
  assert.deepEqual(result, ['assistant fixture']);
  assert.deepEqual(JSON.parse(singleStepRecipes('https://demo.hf.space', parse([scalar('message')]))[0].config.inputs), ['{{message}}']);
});
