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
};
export type GradioEndpoint = {
  apiName: string; inputs: GradioParameter[]; outputs: GradioParameter[];
  inputCount: number; outputCount: number; likelyAgent: boolean;
};
export type GradioDiscovery = ConnectorDiscovery & {spaceUrl: string; endpoints: GradioEndpoint[]};
