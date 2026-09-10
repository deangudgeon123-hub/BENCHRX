import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantOutputIndex, discoverGradio, parseGradioSchema, singleStepRecipes, structuredInputRecipes} from '../lib/server/connectors/gradio-discovery.ts';
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
test('single unresolved output fetches config and uses proven Chatbot metadata', async () => {
  const unresolved = {named_endpoints: {'/chat': {
    parameters: [param('message')],
    returns: [{parameter_name: 'value_2', type: {type: 'object'}, component: ''}],
  }}};
  const config = {
    dependencies: [{api_name: 'chat', inputs: [1], outputs: [2]}],
    components: [
      {id: 1, type: 'textbox', props: {label: 'Message'}},
      {id: 2, type: 'chatbot', props: {label: 'Response'}},
    ],
  };
  const seen: string[] = [];
  const io: ConnectorIO = {
    pin: async raw => ({url: new URL(raw), hostname: new URL(raw).hostname, address: '93.184.216.34', family: 4}),
    request: async (t, o) => {
      assert.equal(o.method, 'GET'); assert.equal(o.headers?.Authorization, undefined);
      seen.push(t.url.pathname);
      if (t.url.pathname === '/gradio_api/info') return {status: 200, headers: {}, text: JSON.stringify(unresolved)};
      if (t.url.pathname === '/config') return {status: 200, headers: {}, text: JSON.stringify(config)};
      throw new Error(`unexpected path ${t.url.pathname}`);
    },
  };
  const d = await discoverGradio('https://demo.hf.space', io);
  assert.deepEqual(seen, ['/gradio_api/info', '/config']);
  assert.equal(d.status, 'proposed');
  assert.equal(d.recipes.length, 1);
  assert.deepEqual(d.recipes[0].config, {space: 'https://demo.hf.space', apiName: 'chat', inputs: '["{{message}}"]', outputIndex: '0'});
  assert.equal(d.endpoints[0].outputs[0].component, 'chatbot');
});
test('agent-like endpoints recognize conversational JSON object and literal json wire outputs', () => {
  const bare = parseGradioSchema({named_endpoints: {'/chat': {
    parameters: [param('message')],
    returns: [{parameter_name: 'Response', type: {type: 'object'}, component: ''}],
  }}});
  const enriched = parseGradioSchema({named_endpoints: {'/chat': {
    parameters: [param('message')],
    returns: [{parameter_name: 'Response', type: {type: 'object'}, component: 'JSON'}],
  }}});
  const literalJson = parseGradioSchema({named_endpoints: {'/chat': {
    parameters: [param('message')],
    returns: [{parameter_name: 'Response', type: {type: 'json'}, component: 'JSON'}],
  }}});
  const unrelated = parseGradioSchema({named_endpoints: {'/chat': {
    parameters: [param('message')],
    returns: [{parameter_name: 'Response', type: {type: 'object'}, component: 'Dataframe'}],
  }}});
  assert.equal(assistantOutputIndex(bare[0]), 0);
  assert.equal(assistantOutputIndex(enriched[0]), 0);
  assert.equal(assistantOutputIndex(literalJson[0]), 0);
  assert.equal(assistantOutputIndex(unrelated[0]), -1);
});
test('ambiguous endpoints require a choice; unknown parameters require manual configuration', async () => {
  const d = await discoverGradio('https://demo.hf.space', ioFor({named_endpoints: {'/chat': endpoint, '/agent': endpoint}}));
  assert.equal(d.status, 'ambiguous'); assert.equal(d.recipes.length, 2);
  const unknown = parseGradioSchema({named_endpoints: {'/chat': {...endpoint, parameters: [param('message'), param('secret')]}}});
  assert.deepEqual(singleStepRecipes('https://demo.hf.space', unknown), []);
});
test('multi-input agents can use declared safe UI control defaults without inventing values', async () => {
  const withDefault = (p: Record<string, unknown>, value: unknown) => ({...p, parameter_has_default: true, parameter_default: value});
  const agentflow = {named_endpoints: {'/solve_problem_gradio': {
    parameters: [
      param('user_query'),
      withDefault(param('max_steps', 'number', 'Slider'), 5),
      withDefault(param('max_time', 'number', 'Slider'), 240),
      withDefault(param('llm_model_engine', 'string', 'Textbox'), 'vllm-AgentFlow/agentflow-planner-7b'),
      withDefault(param('enabled_tools', 'array', 'CheckboxGroup'), ['Base_Generator_Tool', 'Python_Coder_Tool']),
    ],
    returns: [param('Step-wise Problem-Solving Output', 'array', 'Chatbot')],
  }}};
  const d = await discoverGradio('https://demo.hf.space', ioFor(agentflow));
  assert.equal(d.status, 'proposed'); assert.equal(d.recipes.length, 1);
  assert.equal(d.recipes[0].config.apiName, 'solve_problem_gradio');
  assert.deepEqual(JSON.parse(d.recipes[0].config.inputs), ['{{message}}', 5, 240, 'vllm-AgentFlow/agentflow-planner-7b', ['Base_Generator_Tool', 'Python_Coder_Tool']]);
  assert.equal(d.recipes[0].config.outputIndex, '0');
});
test('agent-like endpoints can recover conversational array outputs when Gradio omits the Chatbot component', async () => {
  const withDefault = (p: Record<string, unknown>, value: unknown) => ({...p, parameter_has_default: true, parameter_default: value});
  const schemaOnly = {named_endpoints: {'/solve_problem_gradio': {
    parameters: [
      param('user_query'),
      withDefault(param('max_steps', 'number', 'Slider'), 5),
      withDefault(param('max_time', 'number', 'Slider'), 240),
      withDefault(param('llm_model_engine', 'string', 'Textbox'), 'vllm-AgentFlow/agentflow-planner-7b'),
      withDefault(param('enabled_tools', 'array', 'CheckboxGroup'), ['Base_Generator_Tool']),
    ],
    returns: [{parameter_name: 'Step-wise Problem-Solving Output', type: {type: 'array'}, component: ''}],
  }}};
  const d = await discoverGradio('https://demo.hf.space', ioFor(schemaOnly));
  assert.equal(d.status, 'proposed'); assert.equal(d.recipes.length, 1);
  assert.equal(d.recipes[0].config.apiName, 'solve_problem_gradio');
  assert.equal(d.recipes[0].config.outputIndex, '0');
});
test('structured input endpoints produce editable templates instead of invented fixed values', async () => {
  const travel = parseGradioSchema({named_endpoints: {'/plan_trip': {
    parameters: [param('origin'), param('destination'), param('month'), param('preferences')],
    returns: [param('value_11')],
  }}});
  const recipes = structuredInputRecipes('https://travel.hf.space', travel);
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].config.apiName, 'plan_trip');
  assert.deepEqual(JSON.parse(recipes[0].config.inputs), [
    '<REQUIRED:origin>', '<REQUIRED:destination>', '<REQUIRED:month>', '{{message}}',
  ]);
  const d = await discoverGradio('https://demo.hf.space', ioFor({named_endpoints: {'/plan_trip': {
    parameters: [param('origin'), param('destination'), param('month'), param('preferences')],
    returns: [param('value_11')],
  }}}));
  assert.equal(d.status, 'proposed');
  assert.match(d.message, /Fill every REQUIRED placeholder/);
});
test('structured input discovery refuses ambiguous prompt targets', () => {
  const ambiguous = parseGradioSchema({named_endpoints: {'/run': {
    parameters: [param('task'), param('instructions'), param('region')], returns: [param('answer')],
  }}});
  assert.deepEqual(structuredInputRecipes('https://demo.hf.space', ambiguous), []);
});
test('discovery does not expose schema examples, descriptions or free-form string defaults', async () => {
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
