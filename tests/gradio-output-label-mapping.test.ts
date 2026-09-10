import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverGradio} from '../lib/server/connectors/gradio-discovery.ts';
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
