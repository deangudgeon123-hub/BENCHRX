import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantOutputIndex, parseGradioSchema} from '../lib/server/connectors/gradio-discovery.ts';

const endpointWith = (apiName: string, output: Record<string, unknown>) => parseGradioSchema({named_endpoints: {
  [`/${apiName}`]: {
    parameters: [{parameter_name: 'message', type: {type: 'string'}, component: 'Textbox'}],
    returns: [output],
  },
}})[0];

test('agent-like endpoints accept one conversational JSON output when Gradio omits its schema type', () => {
  const medGemmaShape = endpointWith('chat', {parameter_name: 'Response', type: {}, component: 'JSON'});
  assert.equal(medGemmaShape.outputs[0].type, '');
  assert.equal(medGemmaShape.outputs[0].component, 'json');
  assert.equal(assistantOutputIndex(medGemmaShape), 0);
});

test('unknown JSON outputs still require conversational evidence on an agent-like endpoint', () => {
  const unrelated = endpointWith('chat', {parameter_name: 'Data', type: {}, component: 'JSON'});
  const nonAgent = endpointWith('export_data', {parameter_name: 'Response', type: {}, component: 'JSON'});
  assert.equal(assistantOutputIndex(unrelated), -1);
  assert.equal(assistantOutputIndex(nonAgent), -1);
});
