import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverGradio} from '../lib/server/connectors/gradio-discovery.ts';
import {executeGradioPlan, parsePlan, replacePlaceholders} from '../lib/server/gradio-workflow.ts';
import type {ConnectorIO} from '../lib/server/connectors/interface.ts';
const target = {url: new URL('https://demo.hf.space'), hostname: 'demo.hf.space', address: '93.184.216.34', family: 4 as const};
const message = {parameter_name: 'message', type: {type: 'string'}, component: 'Textbox'};
const history = {parameter_name: 'history', type: {type: 'array'}, component: 'Chatbot', parameter_has_default: true, parameter_default: []};
const schema = {named_endpoints: {
  '/log_user_message': {parameters: [message, history], returns: [message, history]},
  '/interact_with_agent': {parameters: [history], returns: [history]},
}};
const config = {dependencies: [
  {id: 10, api_name: 'log_user_message', inputs: [1, 2], outputs: [1, 2]},
  {id: 11, api_name: 'interact_with_agent', inputs: [2], outputs: [2], trigger_after: 10},
]};
function discoveryIO(graph: unknown = config, apiSchema: unknown = schema): ConnectorIO {return {pin: async () => target, request: async (t, o) => {
  assert.equal(o.method, 'GET');
  return {status: 200, headers: {}, text: JSON.stringify(t.url.pathname === '/config' ? graph : apiSchema)};
}};}
test('auto-discovered two-step chain forwards actual upstream history, not literal empty state', async () => {
  const discovery = await discoverGradio(target.url.href, discoveryIO());
  assert.equal(discovery.status, 'proposed'); assert.equal(discovery.recipes.length, 1);
  const recipe = discovery.recipes[0].config;
  const plan = parsePlan(recipe.inputs, recipe.apiName, recipe.outputIndex);
  assert.deepEqual(plan.steps[1].inputs, ['{{step0.outputs.1}}']);
  const state = [['fixture message', null]];
  const bodies: {data: unknown[]; session_hash: string}[] = [];
  const values = await executeGradioPlan(target, plan, 'fixture message', async (t, o) => {
    if (o.method === 'POST') {bodies.push(JSON.parse(o.body!)); return {status: 200, headers: {}, text: '{"event_id":"evt"}'};}
    const result = t.url.pathname.includes('log_user_message') ? ['', state] : [[['fixture message', 'Final answer']]];
    return {status: 200, headers: {}, text: `event: complete\ndata: ${JSON.stringify(result)}\n\n`};
  });
  assert.deepEqual(bodies[0].data, ['fixture message', []]);
  assert.deepEqual(bodies[1].data, [state]); assert.equal(bodies[0].session_hash, bodies[1].session_hash);
  assert.deepEqual(values[1], [['fixture message', 'Final answer']]);
});
test('declared hidden Gradio fan-in can bridge a one-input messages API safely', async () => {
  const liveLikeSchema = {named_endpoints: {
    '/log_user_message': {parameters: [{parameter_name: 'text_input', type: {type: 'string'}, component: 'Textbox'}], returns: [{parameter_name: 'text_input', type: {type: 'string'}, component: 'Textbox'}]},
    '/interact_with_agent': {parameters: [{parameter_name: 'messages', type: {type: 'array'}, component: 'Chatbot'}], returns: [{parameter_name: 'Agent', type: {type: 'array'}, component: 'Chatbot'}]},
  }};
  // The public API exposes only one input/output per endpoint, while Gradio's UI graph
  // includes hidden upload/chat/session components. Exactly one component (stored messages)
  // is shared from the logging step into the agent step.
  const hiddenGraph = {dependencies: [
    {id: 20, api_name: 'log_user_message', inputs: [1, 7], outputs: [3, 1, 4]},
    {id: 21, api_name: 'interact_with_agent', inputs: [3, 5, 6], outputs: [5], trigger_after: 20},
  ]};
  const discovery = await discoverGradio(target.url.href, discoveryIO(hiddenGraph, liveLikeSchema));
  assert.equal(discovery.status, 'proposed'); assert.equal(discovery.recipes.length, 1);
  assert.equal(discovery.recipes[0].label, '/log_user_message → /interact_with_agent (Chatbot bridge)');
  const recipe = discovery.recipes[0].config;
  const plan = parsePlan(recipe.inputs, recipe.apiName, recipe.outputIndex);
  assert.equal(plan.steps.length, 1); assert.equal(plan.steps[0].apiName, 'interact_with_agent');
  const template = [[{role: 'user', metadata: null, content: '{{message}}', options: null}]];
  assert.deepEqual(plan.steps[0].inputs, template);
  assert.deepEqual(replacePlaceholders(plan.steps[0].inputs, 'BENCHRX_GATEWAY_OK', []), [[{role: 'user', metadata: null, content: 'BENCHRX_GATEWAY_OK', options: null}]]);
});
test('hidden Gradio bridge refuses ambiguous shared component links', async () => {
  const liveLikeSchema = {named_endpoints: {
    '/log_user_message': {parameters: [{parameter_name: 'text_input', type: {type: 'string'}, component: 'Textbox'}], returns: [{parameter_name: 'text_input', type: {type: 'string'}, component: 'Textbox'}]},
    '/interact_with_agent': {parameters: [{parameter_name: 'messages', type: {type: 'array'}, component: 'Chatbot'}], returns: [{parameter_name: 'Agent', type: {type: 'array'}, component: 'Chatbot'}]},
  }};
  const ambiguous = {dependencies: [
    {id: 20, api_name: 'log_user_message', inputs: [1], outputs: [3, 4]},
    {id: 21, api_name: 'interact_with_agent', inputs: [3, 4, 6], outputs: [5], trigger_after: 20},
  ]};
  const discovery = await discoverGradio(target.url.href, discoveryIO(ambiguous, liveLikeSchema));
  assert.equal(discovery.status, 'manual_required'); assert.equal(discovery.recipes.length, 0);
});
test('missing dependency, disconnected state and hidden positional state fall back to manual', async () => {
  for (const changes of [{trigger_after: 999}, {inputs: [9]}, {inputs: [2, 3]}]) {
    const graph = structuredClone(config); Object.assign(graph.dependencies[1], changes);
    const d = await discoverGradio(target.url.href, discoveryIO(graph));
    assert.equal(d.status, 'manual_required'); assert.equal(d.recipes.length, 0);
  }
});
test('full-output references are bounded and legacy selected-output references are unchanged', () => {
  assert.equal(replacePlaceholders('{{step0.1}}', 'prompt', [['a', 'b']]), 'b');
  assert.equal(replacePlaceholders('{{step0.outputs.1}}', 'prompt', ['selected'], [['a', 'b']]), 'b');
  assert.throws(() => replacePlaceholders('{{step1.outputs.0}}', 'prompt', ['selected'], [['a']]));
  assert.throws(() => replacePlaceholders('{{step0.outputs.99}}', 'prompt', ['selected'], [['a']]));
});
