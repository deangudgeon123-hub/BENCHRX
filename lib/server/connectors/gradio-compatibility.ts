import type {ConnectorRecipe, GradioCapabilities, GradioEndpoint} from '../../connectors/types.ts';
import {inferMessageInput} from './gradio-input.ts';

// A text interface is a candidate, never proof of purpose fit or benchmark validity.
// Invocation capability is tracked separately from fixtures the current suite supplies.
export function classifyGradioEndpoint(e: GradioEndpoint, recipes: ConnectorRecipe[], outputIndex: number): GradioCapabilities {
  const base = e.capabilities;
  if (!e.inputCount || !e.outputCount) return {...base, invocation: 'unverified', textSuite: 'no_text_interface', reason: 'no_text_interface'};
  const mediaRequired = e.inputs.some(p => /^(image|file|audio|video|model3d|imageeditor|gallery)$/.test(p.component) &&
    !(p.required === false && p.hasDefault && (p.defaultValue === null || Array.isArray(p.defaultValue) && p.defaultValue.length === 0)));
  if (mediaRequired) return {...base, invocation: 'requires_inputs', textSuite: 'unsupported_inputs', reason: 'requires_media_fixture'};
  const recipe = recipes.find(r => r.config.apiName === e.apiName);
  if (recipe) {
    const template = recipe.kind === 'template';
    return {...base, invocation: template ? 'requires_inputs' : 'recipe_available',
      textSuite: template ? 'requires_fixed_inputs' : 'text_candidate', reason: template ? 'operator_values_required' : 'text_interface_candidate'};
  }
  if (inferMessageInput(e).index < 0) return {...base, invocation: 'manual_required', textSuite: 'manual_required', reason: 'message_mapping_unproven'};
  return {...base, invocation: 'manual_required', textSuite: 'manual_required', reason: outputIndex < 0 ? 'output_mapping_unproven' : 'operator_values_required'};
}
