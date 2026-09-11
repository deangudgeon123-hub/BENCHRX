import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverGradio, parseGradioSchema, singleStepRecipes} from '../lib/server/connectors/gradio-discovery.ts';
import type {ConnectorIO} from '../lib/server/connectors/interface.ts';

const param = (name: string, type = 'string', component = 'Textbox') => ({parameter_name: name, type: {type}, component});
const declared = (name: string, value: unknown) => ({...param(name), parameter_has_default: true, parameter_default: value});
const answer = param('answer');

function ioFor(body: unknown): ConnectorIO {
  return {
    pin: async raw => ({url: new URL(raw), hostname: new URL(raw).hostname, address: '93.184.216.34', family: 4}),
    request: async (target, options) => {
      assert.equal(target.url.pathname, '/gradio_api/info');
      assert.equal(options.method, 'GET');
      return {status: 200, headers: {}, text: JSON.stringify(body)};
    },
  };
}

test('prompt-bearing selector-like textbox defaults stay redacted and out of recipes', async () => {
  const marker = 'STAGE3_PRIVATE_DEFAULT_SHOULD_NOT_LEAK';
  const schema = {named_endpoints: {'/chat': {
    parameters: [param('message'), declared('model_system_prompt', marker)],
    returns: [answer],
  }}};

  const discovery = await discoverGradio('https://demo.hf.space', ioFor(schema));
  const promptParameter = discovery.endpoints[0].inputs[1];

  assert.equal(promptParameter.hasDefault, false);
  assert.equal(promptParameter.defaultSafety, 'redacted');
  assert.equal(Object.hasOwn(promptParameter, 'defaultValue'), false);
  assert.equal(JSON.stringify(discovery).includes(marker), false);
  assert.equal(discovery.recipes.some(recipe => recipe.kind === 'executable'), false);
  assert.deepEqual(JSON.parse(discovery.recipes[0].config.inputs), ['{{message}}', '<REQUIRED:model_system_prompt>']);
});

test('narrowly supported textbox selector defaults remain executable', () => {
  const selectorNames = ['model', 'engine', 'backend', 'provider', 'llm_model_engine'];
  const endpoint = parseGradioSchema({named_endpoints: {'/chat': {
    parameters: [param('message'), ...selectorNames.map((name, index) => declared(name, `selector-${index}`))],
    returns: [answer],
  }}})[0];

  assert.deepEqual(endpoint.inputs.slice(1).map(input => input.defaultSafety), selectorNames.map(() => 'safe'));
  const [recipe] = singleStepRecipes('https://demo.hf.space', [endpoint]);
  assert.equal(recipe.kind, 'executable');
  assert.deepEqual(JSON.parse(recipe.config.inputs), ['{{message}}', 'selector-0', 'selector-1', 'selector-2', 'selector-3', 'selector-4']);
});
