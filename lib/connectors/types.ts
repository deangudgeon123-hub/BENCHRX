// Serializable discovery output only; never carries service credentials or raw diagnostics.
export type ProviderId = 'generic' | 'gradio';
export type ConnectorRecipe = {label: string; provider: ProviderId; config: Record<string, string>};
export type ConnectorDiscovery = {
  provider: ProviderId;
  status: 'manual_required' | 'proposed' | 'ambiguous';
  message: string;
  recipes: ConnectorRecipe[];
};
