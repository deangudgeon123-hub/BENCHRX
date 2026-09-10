import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGradioSchema, singleStepRecipes, structuredInputRecipes} from '../lib/server/connectors/gradio-discovery.ts';
import {executeGradioPlan, parsePlan, parseGradioTemplate} from '../lib/server/gradio-workflow.ts';
import {createGradioConnector} from '../lib/server/connectors/gradio.ts';
import {invokeNormalizedConnector} from '../lib/server/connectors/interface.ts';
const p = (name: string, type = 'string', component = 'Textbox') => ({parameter_name: name, type: {type}, component, parameter_has_default: false});
const parse = (parameters: unknown[]) => parseGradioSchema({named_endpoints: {'/predict': {parameters, returns: [p('answer')]}}});
const declared = (parameter: ReturnType<typeof p>, value: unknown) => ({...parameter, parameter_has_default: true, parameter_default: value});

test('typed structured templates require operator-supplied numbers, objects and files without fabrication', () => {
  const endpoints = parse([p('question'), p('limit', 'number', 'Slider'), p('settings', 'object', 'JSON'), p('document', 'object', 'File')]);
  assert.deepEqual(singleStepRecipes('https://demo.hf.space', endpoints), []);
  const [recipe] = structuredInputRecipes('https://demo.hf.space', endpoints);
  assert.equal(recipe.kind, 'template');
  assert.deepEqual(JSON.parse(recipe.config.inputs), ['{{message}}', '<REQUIRED:limit>', '<REQUIRED:settings>', '<REQUIRED:document>']);
  assert.deepEqual(recipe.requiredInputs?.map(p => p.type), ['number', 'object', 'object']);
  assert.deepEqual(recipe.requiredInputs?.map(p => p.index), [1, 2, 3]);
  assert.throws(() => parsePlan(recipe.config.inputs, recipe.config.apiName, recipe.config.outputIndex), /REQUIRED/);
});

test('declared safe controls produce an executable proposal while incompatible defaults stay required', () => {
  const [recipe] = singleStepRecipes('https://demo.hf.space', parse([p('question'), declared(p('model', 'string', 'Dropdown'), 'public-model'),
    declared(p('mode', 'string', 'Radio'), 'simple'), declared(p('limit', 'number', 'Slider'), 5)]));
  assert.equal(recipe.kind, 'executable'); assert.deepEqual(recipe.requiredInputs, []);
  assert.deepEqual(JSON.parse(recipe.config.inputs), ['{{message}}', 'public-model', 'simple', 5]);
  const endpoints = parse([p('question'), declared(p('limit', 'number', 'Slider'), ''), declared(p('metadata', 'object', 'JSON'), [])]);
  assert.equal(endpoints[0].inputs[1].hasDefault, false);
  assert.deepEqual(JSON.parse(structuredInputRecipes('https://demo.hf.space', endpoints)[0].config.inputs), ['{{message}}', '<REQUIRED:limit>', '<REQUIRED:metadata>']);
});

test('sensitive defaults are redacted before primitive shortcuts or control checks', () => {
  for (const value of [987654321, false, '', null, [], {}, 'private-value']) {
    const endpoints = parse([p('question'), declared(p('api_key'), value)]);
    assert.equal(endpoints[0].inputs[1].hasDefault, false);
    assert.equal(Object.hasOwn(endpoints[0].inputs[1], 'defaultValue'), false);
    assert.deepEqual(singleStepRecipes('https://demo.hf.space', endpoints), []);
    assert.deepEqual(structuredInputRecipes('https://demo.hf.space', endpoints), []);
  }
  const endpoints = parse([p('question'), {...declared(p('parameter_1', 'string', 'Dropdown'), 'private-value'), label: 'API key'}]);
  assert.equal(JSON.stringify(endpoints).includes('private-value'), false);
  const spoofed = parse([p('question'), {...declared(p('access_token', 'number', 'Slider'), 12345), label: 'Max new tokens'}]);
  assert.equal(spoofed[0].inputs[1].hasDefault, false);
});

test('unresolved templates cannot reach transport, including nested values and workflow steps', async () => {
  const target = {url: new URL('https://example.com'), hostname: 'example.com', address: '93.184.216.34', family: 4 as const};
  let calls = 0;
  const transport = async () => {calls++; throw new Error('must not invoke');};
  const raw = JSON.stringify({steps: [{apiName: 'prepare', inputs: ['{{message}}']}, {apiName: 'answer', inputs: [{limit: '<REQUIRED:limit>'}]}]});
  assert.throws(() => parsePlan(raw, 'answer', '0'), /REQUIRED/);
  await assert.rejects(executeGradioPlan(target, parseGradioTemplate(raw, 'answer', '0'), 'fixture', transport), /REQUIRED/);
  const provider = createGradioConnector({pin: async () => target, request: transport});
  const result = await invokeNormalizedConnector(provider, new URLSearchParams({space: target.url.href, apiName: 'predict', inputs: '["{{message}}","<REQUIRED:option_a>"]'}), {message: 'fixture'});
  assert.equal(result.outcome, 'connector_failure'); assert.equal(result.response, null); assert.equal(calls, 0);
  // Operator-provided values retain the existing manual JSON format.
  assert.doesNotThrow(() => parsePlan('["{{message}}",3,{"enabled":true}]', 'predict', '0'));
});
