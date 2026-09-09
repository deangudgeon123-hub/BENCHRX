import type {ConnectorRecipe} from './types.ts';
// Exact allowlist prevents recipes from setting unrelated form fields or auth headers.
export function gradioRecipeFields(recipe: ConnectorRecipe): Record<string, string> {
  if (recipe.provider !== 'gradio') throw new Error('Not a Gradio recipe');
  const {space, apiName, inputs, outputIndex} = recipe.config;
  if ([space, apiName, inputs, outputIndex].some(v => typeof v !== 'string')) throw new Error('Incomplete Gradio recipe');
  return {spaceUrl: space, apiName, gradioInputs: inputs, outputIndex};
}
