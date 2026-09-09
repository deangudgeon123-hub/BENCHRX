import type {ConnectorRecipe, GradioEndpoint} from '../../connectors/types.ts';
import {parsePlan} from '../gradio-workflow.ts';

const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const stateful = (p: GradioEndpoint['inputs'][number]) => /state|chatbot/i.test(p.component) || /history|state|context/i.test(p.name);
const stringParam = (p: GradioEndpoint['inputs'][number]) => /^(string|str)$/.test(p.type);
const arrayParam = (p: GradioEndpoint['inputs'][number]) => /^(array|list)$/.test(p.type) || p.component === 'chatbot';

function chatbotBridgeRecipe(
  spaceUrl: string,
  first: GradioEndpoint,
  second: GradioEndpoint,
  firstOutputs: unknown[],
  secondInputs: unknown[],
  outputIndex: (e: GradioEndpoint) => number,
): ConnectorRecipe | null {
  // Some Gradio apps expose only the visible textbox return from log_user_message,
  // while their dependency graph also wires hidden stored-message/chatbot/session values
  // into the agent step. When the graph proves exactly one shared component between
  // those steps, use the exposed messages API directly rather than guessing hidden
  // positional arguments.
  if (first.inputCount !== 1 || !stringParam(first.inputs[0])) return null;
  if (second.inputCount !== 1 || !arrayParam(second.inputs[0])) return null;
  const linkedComponents = [...new Set(firstOutputs.filter(id => secondInputs.includes(id)))];
  if (linkedComponents.length !== 1) return null;
  const finalOutput = outputIndex(second);
  if (finalOutput < 0) return null;
  const inputs = JSON.stringify([[{role: 'user', content: '{{message}}'}]]);
  parsePlan(inputs, second.apiName, String(finalOutput));
  return {
    provider: 'gradio',
    label: '/log_user_message → /interact_with_agent (Chatbot bridge)',
    config: {space: spaceUrl, apiName: second.apiName, inputs, outputIndex: String(finalOutput)},
  };
}

// Phase 1 recognizes this declared chain only; endpoint names alone are not dataflow evidence.
export function statefulRecipes(spaceUrl: string, endpoints: GradioEndpoint[], rawConfig: unknown, outputIndex: (e: GradioEndpoint) => number): ConnectorRecipe[] {
  const config = obj(rawConfig);
  if (!Array.isArray(config.dependencies) || config.dependencies.length > 128) return [];
  const dependencies = config.dependencies.map(obj);
  const first = endpoints.find(e => e.apiName === 'log_user_message');
  const second = endpoints.find(e => e.apiName === 'interact_with_agent');
  if (!first || !second) return [];
  const find = (name: string) => dependencies.filter(d => d.api_name === name || d.api_name === '/' + name);
  const firstDeps = find(first.apiName), secondDeps = find(second.apiName);
  if (firstDeps.length !== 1 || secondDeps.length !== 1) return [];
  const a = firstDeps[0], b = secondDeps[0];
  if (b.trigger_after !== (a.id ?? dependencies.indexOf(a))) return [];
  const aIn = a.inputs, aOut = a.outputs, bIn = b.inputs, bOut = b.outputs;
  if (!Array.isArray(aIn) || !Array.isArray(aOut) || !Array.isArray(bIn) || !Array.isArray(bOut) ||
      [...aIn, ...aOut, ...bIn, ...bOut].some(id => !Number.isSafeInteger(id))) return [];

  const bridge = chatbotBridgeRecipe(spaceUrl, first, second, aOut, bIn, outputIndex);

  // Hidden component inputs/outputs can make API-schema counts differ from dependency-graph counts.
  // Use the explicit Chatbot bridge above when that exact declared link is present.
  if (aIn.length !== first.inputCount || aOut.length !== first.outputCount || bIn.length !== second.inputCount || bOut.length !== second.outputCount) {
    return bridge ? [bridge] : [];
  }

  const messageInputs = first.inputs.map((p, i) => ({p, i})).filter(({p}) => /^(message|user_message|prompt|text|user_input)$/i.test(p.name) && /^(string|str)$/.test(p.type));
  if (messageInputs.length !== 1) return bridge ? [bridge] : [];
  const messageIndex = messageInputs[0].i;
  if (first.inputs.some((p, i) => i !== messageIndex && !p.hasDefault)) return bridge ? [bridge] : [];
  const initial = first.inputs.map((p, i) => i === messageIndex ? '{{message}}' : p.defaultValue);
  let linked = 0;
  const next: unknown[] = [];
  for (let i = 0; i < second.inputs.length; i++) {
    const sources = aOut.map((id, j) => ({id, j})).filter(x => x.id === bIn[i]);
    if (sources.length > 1) return bridge ? [bridge] : [];
    if (sources.length === 1) {next.push(`{{step0.outputs.${sources[0].j}}}`); linked++;}
    else if (stateful(second.inputs[i]) || !second.inputs[i].hasDefault) return bridge ? [bridge] : [];
    else next.push(second.inputs[i].defaultValue);
  }
  const finalOutput = outputIndex(second);
  if (!linked || finalOutput < 0 || first.outputCount === 0) return bridge ? [bridge] : [];
  const plan = {steps: [{apiName: first.apiName, inputs: initial, outputIndex: 0}, {apiName: second.apiName, inputs: next, outputIndex: finalOutput}], finalStep: 1};
  const inputs = JSON.stringify(plan);
  parsePlan(inputs, second.apiName, String(finalOutput));
  return [{provider: 'gradio', label: '/log_user_message → /interact_with_agent', config: {space: spaceUrl, apiName: second.apiName, inputs, outputIndex: String(finalOutput)}}];
}
