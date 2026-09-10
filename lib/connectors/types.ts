// Serializable discovery output only; never carries service credentials or raw diagnostics.
export type ProviderId = 'generic' | 'gradio';
export type ConnectorRecipe = {label: string; provider: ProviderId; config: Record<string, string>};
export type ConnectorDiscovery = {
  provider: ProviderId;
  status: 'manual_required' | 'proposed' | 'ambiguous';
  message: string;
  recipes: ConnectorRecipe[];
};
export type GradioParameter = {
  name: string; type: string; component: string;
  hasDefault: boolean; defaultValue?: unknown;
  label: string;
  required: boolean | null;
  declaredDefault: boolean;
  defaultSafety: 'absent' | 'safe' | 'redacted';
  state: boolean;
  hidden: boolean | null;
  componentId?: number;
  wireIndex?: number;
};
export type GradioWireSlot = {
  componentId: number; wireIndex: number; state: boolean; hidden: boolean;
  visibleIndex?: number;
};
export type GradioDependency = {
  id: number | null; triggerAfter: number | null;
  inputs: GradioWireSlot[]; outputs: GradioWireSlot[];
};
export type GradioCapabilities = {
  textInputCandidates: number[]; structuredInputCandidates: number[];
  assistantOutputCandidates: number[];
  invocation: 'unverified'; textSuite: 'unverified';
  workflow: 'unknown' | 'dependency_declared' | 'shared_state_required';
};
export type GradioEndpoint = {
  apiName: string; inputs: GradioParameter[]; outputs: GradioParameter[];
  inputCount: number; outputCount: number; likelyAgent: boolean;
  dependency?: GradioDependency;
  capabilities: GradioCapabilities;
};
export type GradioDiscovery = ConnectorDiscovery & {spaceUrl: string; endpoints: GradioEndpoint[]};
