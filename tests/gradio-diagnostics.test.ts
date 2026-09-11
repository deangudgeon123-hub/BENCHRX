import test from 'node:test';
import assert from 'node:assert/strict';
import {gradioEndpointDiagnostics} from '../lib/connectors/gradio-diagnostics.ts';
import type {GradioEndpoint} from '../lib/connectors/types.ts';

const endpoint: GradioEndpoint = {
  apiName: 'chat', inputCount: 3, outputCount: 1, likelyAgent: true,
  inputs: [
    {name: 'message', label: '', type: 'object', component: 'multimodaltextbox', hasDefault: false, required: true, declaredDefault: false, defaultSafety: 'absent', state: false, hidden: false, messageShape: 'text_files'},
    {name: 'param_2', label: '', type: 'string', component: 'textbox', hasDefault: false, required: false, declaredDefault: true, defaultSafety: 'redacted', state: false, hidden: false, messageShape: null, defaultValue: 'SHOULD_NOT_LEAK'},
    {name: 'param_3', label: '', type: 'number', component: 'slider', hasDefault: true, required: false, declaredDefault: true, defaultSafety: 'safe', state: false, hidden: false, messageShape: null, defaultValue: 2048},
  ],
  outputs: [
    {name: 'Response', label: '', type: 'json', component: 'json', hasDefault: false, required: null, declaredDefault: false, defaultSafety: 'absent', state: false, hidden: false, messageShape: null},
  ],
  capabilities: {
    textInputCandidates: [1], structuredInputCandidates: [0], assistantOutputCandidates: [],
    invocation: 'manual_required', textSuite: 'manual_required', reason: 'operator_values_required', workflow: 'dependency_declared',
  },
};

test('discovery diagnostics expose only classification metadata and never default values', () => {
  const diagnostics = gradioEndpointDiagnostics(endpoint);
  assert.equal(diagnostics.reason, 'operator_values_required');
  assert.equal(diagnostics.invocation, 'manual_required');
  assert.deepEqual(diagnostics.schemaCandidates, {textInputs: [1], structuredInputs: [0], assistantOutputs: []});
  assert.equal(diagnostics.inputs[0].messageShape, 'text_files');
  assert.equal(diagnostics.inputs[1].defaultSafety, 'redacted');
  assert.equal(diagnostics.inputs[2].defaultSafety, 'safe');
  assert.equal(diagnostics.outputs[0].type, 'json');
  assert.equal(JSON.stringify(diagnostics).includes('SHOULD_NOT_LEAK'), false);
  assert.equal(JSON.stringify(diagnostics).includes('2048'), false);
});
