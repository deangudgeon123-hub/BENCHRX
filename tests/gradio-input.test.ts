import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGradioSchema, singleStepRecipes, structuredInputRecipes} from '../lib/server/connectors/gradio-discovery.ts';
import {inferMessageInput} from '../lib/server/connectors/gradio-input.ts';
const p = (name: string, component = 'Textbox', type = 'string') => ({parameter_name: name, component, type: {type}});
const endpoint = (parameters: unknown[], apiName = 'predict') => parseGradioSchema({named_endpoints: {[`/${apiName}`]: {parameters, returns: [p('answer')]}}})[0];

test('message inference combines text type/control with semantic names and labels', () => {
  for (const name of ['message', 'user_message', 'prompt', 'text', 'query', 'question', 'input', 'user_input', 'user_query', 'request', 'instructions', 'task', 'description', 'preferences', 'requirements', 'context']) {
    assert.equal(inferMessageInput(endpoint([p(name), p('option_a')])).index, 0, name);
  }
  assert.equal(inferMessageInput(endpoint([{...p('parameter_0'), label: 'User question'}])).index, 0);
  assert.equal(inferMessageInput(endpoint([{...p('parameter_0'), label: 'User input'}])).index, 0);
  assert.equal(inferMessageInput(endpoint([p('prompt', 'Slider', 'number')])).index, -1);
  assert.equal(inferMessageInput(endpoint([p('question', 'Dropdown')])).index, -1);
  assert.equal(inferMessageInput(endpoint([p('message', 'State')])).index, -1);
});

test('semantic Gradio api inputs can carry benchmark messages without broad api fallback', () => {
  assert.equal(inferMessageInput(endpoint([p('message', 'api')], 'chat')).index, 0);
  assert.equal(inferMessageInput(endpoint([p('user_query', 'api')], 'chat')).index, 0);
  assert.equal(inferMessageInput(endpoint([p('payload', 'api')], 'chat')).index, -1);
  assert.equal(inferMessageInput(endpoint([{...p('message', 'api'), label: 'API key'}], 'chat')).index, -1);
});

test('Bella-style chat maps message but preserves required history as operator input', () => {
  const bella = parseGradioSchema({named_endpoints: {'/chat': {
    parameters: [p('message', 'api'), p('history', 'api', 'array')],
    returns: [p('1st', 'api'), p('2nd', 'api', 'array')],
  }}})[0];
  assert.equal(inferMessageInput(bella).index, 0);
  assert.deepEqual(singleStepRecipes('https://demo.hf.space', [bella]), []);
  const [recipe] = structuredInputRecipes('https://demo.hf.space', [bella]);
  assert.equal(recipe.kind, 'template');
  assert.deepEqual(JSON.parse(recipe.config.inputs), ['{{message}}', '<REQUIRED:history>']);
  assert.equal(recipe.config.outputIndex, '0');
});

test('MCQ question maps once; required options are never invented', () => {
  const e = endpoint(['question', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e'].map(name => p(name)), 'solve_mcq');
  assert.equal(inferMessageInput(e).index, 0);
  assert.deepEqual(singleStepRecipes('https://demo.hf.space', [e]), []);
  const [recipe] = structuredInputRecipes('https://demo.hf.space', [e]);
  assert.deepEqual(JSON.parse(recipe.config.inputs), ['{{message}}', '<REQUIRED:option_a>', '<REQUIRED:option_b>', '<REQUIRED:option_c>', '<REQUIRED:option_d>', '<REQUIRED:option_e>']);
});

test('competing semantic fields and unnamed multiple strings remain ambiguous', () => {
  for (const names of [['question', 'prompt'], ['task', 'instructions'], ['question', 'context'], ['first', 'second']]) {
    const e = endpoint(names.map(name => p(name)));
    assert.equal(inferMessageInput(e).status, 'ambiguous');
    assert.deepEqual(singleStepRecipes('https://demo.hf.space', [e]), []);
    assert.deepEqual(structuredInputRecipes('https://demo.hf.space', [e]), []);
  }
});

test('credentials, model selectors and fixed fields cannot win the sole-string fallback', () => {
  for (const name of ['api_key', 'token', 'password', 'model', 'backend', 'system_prompt', 'origin', 'option_a']) {
    assert.equal(inferMessageInput(endpoint([p(name)])).index, -1, name);
  }
  assert.equal(inferMessageInput(endpoint([{...p('api_key'), label: 'Question'}])).index, -1);
  assert.equal(inferMessageInput(endpoint([{...p('question'), label: 'API key'}])).index, -1);
});

test('Travel and simple predict-style text agents retain their mappings', () => {
  assert.equal(inferMessageInput(endpoint(['origin', 'destination', 'month', 'preferences'].map(name => p(name)), 'plan_trip')).index, 3);
  for (const name of ['message', 'prompt', 'text_input', 'parameter_0']) {
    assert.deepEqual(JSON.parse(singleStepRecipes('https://demo.hf.space', [endpoint([p(name)])])[0].config.inputs), ['{{message}}']);
  }
});
