import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverGradio, parseGradioSchema, assistantOutputIndex} from '../lib/server/connectors/gradio-discovery.ts';
import type {ConnectorIO} from '../lib/server/connectors/interface.ts';

const schema = {named_endpoints: {'/_run': {
  parameters: [{parameter_name: 'prompt', type: {type: 'string'}, component: 'Textbox'}],
  returns: [
    {parameter_name: 'value_10', type: {type: 'string'}, component: 'Markdown'},
    {parameter_name: 'value_11', type: {type: 'string'}, component: 'HTML'},
    {parameter_name: 'value_12', type: {type: 'string'}, component: 'Markdown'},
    {parameter_name: 'value_13', type: {type: 'string'}, component: 'Markdown'},
    {parameter_name: 'value_14', type: {type: 'array'}, component: 'File'},
  ],
}}};

const config = {
  components: [
    {id: 10, type: 'markdown', props: {label: 'Status'}},
    {id: 11, type: 'html', props: {label: 'Task board'}},
    {id: 12, type: 'markdown', props: {label: 'Activity'}},
    {id: 13, type: 'markdown', props: {label: 'Final answer'}},
    {id: 14, type: 'file', props: {label: 'Output files'}},
    {id: 15, type: 'state', props: {}},
    {id: 16, type: 'state', props: {}},
  ],
  dependencies: [{api_name: '_run', outputs: [10, 11, 12, 13, 14, 15, 16]}],
};

function io(): ConnectorIO {
  return {
    pin: async raw => ({url: new URL(raw), hostname: new URL(raw).hostname, address: '93.184.216.34', family: 4}),
    request: async (target, options) => {
      assert.equal(options.method, 'GET');
      assert.equal(options.headers?.Authorization, undefined);
      if (target.url.pathname === '/gradio_api/info') return {status: 200, headers: {}, text: JSON.stringify(schema)};
      if (target.url.pathname === '/config') return {status: 200, headers: {}, text: JSON.stringify(config)};
      throw new Error(`unexpected path ${target.url.pathname}`);
    },
  };
}

test('multi-output discovery uses config labels to select the real assistant answer slot', async () => {
  const discovery = await discoverGradio('https://demo.hf.space', io());
  assert.equal(discovery.status, 'proposed');
  assert.equal(discovery.recipes.length, 1);
  assert.equal(discovery.recipes[0].config.apiName, '_run');
  assert.equal(discovery.recipes[0].config.outputIndex, '3');
  assert.equal(discovery.endpoints[0].outputs[3].name, 'Final answer');
  assert.equal(discovery.endpoints[0].outputs[4].name, 'Output files');
});

test('current transcript pane is selected instead of file output and hidden State wire slots are retained', async () => {
  // Live Frontier surface: State is omitted from /info, but remains in /config arity.
  const liveSchema = {named_endpoints: {'/_run': {parameters: schema.named_endpoints['/_run'].parameters, returns: [
    {parameter_name: 'value_22', type: {type: 'string'}, component: 'Markdown'},
    {parameter_name: 'value_28', type: {type: 'string'}, component: 'HTML'},
    {parameter_name: 'value_29', type: {type: 'string'}, component: 'HTML'},
    {parameter_name: 'value_24', type: {type: 'string'}, component: 'Markdown'},
    {parameter_name: 'value_30', type: {type: 'array'}, component: 'File'},
    {parameter_name: 'value_23', type: {type: 'string'}, component: 'Markdown'},
  ]}}};
  const liveConfig = {components: [
    {id: 8, type: 'textbox'}, {id: 1, type: 'state'}, {id: 2, type: 'state'}, {id: 3, type: 'state'},
    {id: 22, type: 'markdown'}, {id: 28, type: 'html'}, {id: 29, type: 'html', props: {label: 'Activity'}},
    {id: 24, type: 'markdown', props: {label: 'Current turn'}}, {id: 30, type: 'file', props: {label: 'Output files'}},
    {id: 23, type: 'markdown', props: {label: 'Earlier in this conversation', visible: false}},
  ], dependencies: [{id: 0, api_name: '_run', inputs: [8, 1, 3], outputs: [22, 28, 29, 24, 30, 2, 1, 23]}]};
  const connection = io();
  connection.request = async target => ({status: 200, headers: {}, text: JSON.stringify(target.url.pathname === '/config' ? liveConfig : liveSchema)});
  const d = await discoverGradio('https://demo.hf.space', connection);
  assert.equal(d.recipes[0].config.outputIndex, '3');
  assert.deepEqual(JSON.parse(d.recipes[0].config.inputs), ['{{message}}', null, null]);
});

test('explicit File arrays never qualify for the missing-Chatbot-component fallback', () => {
  const [endpoint] = parseGradioSchema({named_endpoints: {'/_run': {parameters: schema.named_endpoints['/_run'].parameters,
    returns: [{parameter_name: 'Output files', type: {type: 'array'}, component: 'File'}]}}});
  assert.equal(assistantOutputIndex(endpoint), -1);
});
