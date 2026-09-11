import type {GradioEndpoint} from './types.ts';

export type GradioEndpointDiagnostics = {
  reason: NonNullable<GradioEndpoint['capabilities']['reason']> | 'unclassified';
  invocation: GradioEndpoint['capabilities']['invocation'];
  textSuite: GradioEndpoint['capabilities']['textSuite'];
  workflow: GradioEndpoint['capabilities']['workflow'];
  schemaCandidates: {
    textInputs: number[];
    structuredInputs: number[];
    assistantOutputs: number[];
  };
  inputs: Array<{
    index: number;
    type: string;
    component: string;
    messageShape: 'text_files' | null;
    defaultSafety: 'absent' | 'safe' | 'redacted';
    required: boolean | null;
    state: boolean;
    hidden: boolean | null;
  }>;
  outputs: Array<{
    index: number;
    type: string;
    component: string;
    state: boolean;
    hidden: boolean | null;
  }>;
};

// Diagnostics are deliberately derived only from already-sanitized discovery metadata.
// Never include defaultValue, descriptions, examples, labels, URLs, or raw schema/config.
export function gradioEndpointDiagnostics(endpoint: GradioEndpoint): GradioEndpointDiagnostics {
  return {
    reason: endpoint.capabilities.reason ?? 'unclassified',
    invocation: endpoint.capabilities.invocation,
    textSuite: endpoint.capabilities.textSuite,
    workflow: endpoint.capabilities.workflow,
    schemaCandidates: {
      textInputs: [...endpoint.capabilities.textInputCandidates],
      structuredInputs: [...endpoint.capabilities.structuredInputCandidates],
      assistantOutputs: [...endpoint.capabilities.assistantOutputCandidates],
    },
    inputs: endpoint.inputs.map((input, index) => ({
      index,
      type: input.type,
      component: input.component,
      messageShape: input.messageShape,
      defaultSafety: input.defaultSafety,
      required: input.required,
      state: input.state,
      hidden: input.hidden,
    })),
    outputs: endpoint.outputs.map((output, index) => ({
      index,
      type: output.type,
      component: output.component,
      state: output.state,
      hidden: output.hidden,
    })),
  };
}
