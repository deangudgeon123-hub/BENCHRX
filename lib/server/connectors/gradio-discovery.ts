import type {ConnectorRecipe, GradioDiscovery, GradioEndpoint, GradioParameter} from '../../connectors/types.ts';
import {publicConnectorIO, type ConnectorIO} from './interface.ts';
import type {ValidatedHttpsTarget} from '../pinned-https.ts';
import {statefulRecipes} from './gradio-chaining.ts';
import {parsePlan} from '../gradio-workflow.ts';

const URL_OPTIONS = {invalidUrlMessage: 'Enter a public Gradio or Hugging Face Space URL.', httpsRequiredMessage: 'Discovery requires a public HTTPS Space.'};
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const label = (v: unknown): string => typeof v === 'string' ? v.slice(0, 100) : '';
const SENSITIVE_NAME = /api[_-]?key|token|secret|password|credential|authorization|bearer/i;

// Expose only harmless defaults. Free-form text defaults can contain credentials or
// private prompt material, so keep them redacted. Declared selection controls are
// different: their current value is part of the public UI configuration and is needed
// to invoke multi-input agents without inventing values.
function safeDefault(v: unknown, component: string, name = ''): boolean {
  if (v === null || v === '' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) ||
      (Array.isArray(v) && v.length === 0) || (v !== null && typeof v === 'object' && Object.keys(v).length === 0)) return true;
  if (SENSITIVE_NAME.test(name)) return false;
  if (/^(dropdown|radio)$/i.test(component)) return typeof v === 'string' || typeof v === 'number';
  if (/^(checkboxgroup|checkbox-group)$/i.test(component)) {
    return Array.isArray(v) && v.length <= 32 && v.every(item => typeof item === 'string' && item.length <= 100);
  }
  // Model/backend selectors are often rendered as textboxes in public Gradio apps.
  // Accept only narrowly named, declared defaults; arbitrary textbox defaults remain hidden.
  if (/^(textbox|text)$/i.test(component) && /model|engine|backend|provider/i.test(name)) {
    return typeof v === 'string' && v.length <= 200;
  }
  return false;
}
function parameter(raw: unknown, index: number): GradioParameter {
  const p = object(raw), type = object(p.type), python = object(p.python_type);
  const component = label(p.component).toLowerCase();
  const name = label(p.parameter_name || p.label) || `parameter_${index}`;
  const hasDefault = p.parameter_has_default === true && safeDefault(p.parameter_default, component, name);
  return {name, type: label(type.type || python.type), component, hasDefault, ...(hasDefault ? {defaultValue: p.parameter_default} : {})};
}
export function parseGradioSchema(raw: unknown): GradioEndpoint[] {
  const named = object(object(raw).named_endpoints);
  if (Object.keys(named).length > 64) throw new Error('Too many Gradio endpoints to discover safely.');
  return Object.entries(named).flatMap(([path, value]) => {
    const apiName = path.replace(/^\//, ''), e = object(value);
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(apiName) || !Array.isArray(e.parameters) || !Array.isArray(e.returns)) return [];
    if (e.parameters.length > 32 || e.returns.length > 32) return [];
    const inputs = e.parameters.map(parameter), outputs = e.returns.map(parameter);
    return [{apiName, inputs, outputs, inputCount: inputs.length, outputCount: outputs.length,
      likelyAgent: /chat|agent|respond|predict|generate|solve|plan|^_?run$/i.test(apiName)}];
  });
}
function messageIndex(e: GradioEndpoint): number {
  const strings = e.inputs.map((p, i) => ({p, i})).filter(({p}) => p.type === 'string' || p.type === 'str');
  const named = strings.filter(({p}) => /^(message|user_message|prompt|text|query|input|user_input|user_query)$/i.test(p.name));
  return named.length === 1 ? named[0].i : named.length === 0 && strings.length === 1 && e.likelyAgent ? strings[0].i : -1;
}
function structuredMessageIndex(e: GradioEndpoint): number {
  if (e.inputs.length < 2) return -1;
  const candidates = e.inputs.map((p, i) => ({p, i})).filter(({p}) =>
    (p.type === 'string' || p.type === 'str') &&
    /^(preferences?|instructions?|task|request|requirements?|details?|context|description)$/i.test(p.name));
  return candidates.length === 1 ? candidates[0].i : -1;
}
export function assistantOutputIndex(e: GradioEndpoint): number {
  const chat = e.outputs.map((p, i) => ({p, i})).filter(({p}) => p.component === 'chatbot');
  if (chat.length === 1) return chat[0].i;
  const text = e.outputs.map((p, i) => ({p, i})).filter(({p}) =>
    (p.type === 'string' || p.type === 'str') && !/user|prompt|input|message|status/i.test(p.name));
  const named = text.filter(({p}) => /assistant|answer|response|output|transcript/i.test(p.name));
  if (named.length === 1) return named[0].i;
  if (text.length === 1) return text[0].i;

  // Some Gradio versions expose Chatbot(messages) returns only as array/list in the
  // public API schema, without preserving the component type. For an agent-like
  // endpoint, accept exactly one conversationally named structured output. Invocation
  // still has to pass normal assistant-text extraction before the connection succeeds.
  const structured = e.outputs.map((p, i) => ({p, i})).filter(({p}) =>
    /^(array|list)$/.test(p.type) && /assistant|answer|response|output|history|messages?|transcript|conversation|solution|problem[-_ ]?solving/i.test(p.name));
  return e.likelyAgent && structured.length === 1 ? structured[0].i : -1;
}
export function singleStepRecipes(spaceUrl: string, endpoints: GradioEndpoint[]): ConnectorRecipe[] {
  return endpoints.flatMap(e => {
    const message = messageIndex(e), output = assistantOutputIndex(e);
    if (message < 0 || output < 0 || e.inputs.some((p, i) => i !== message && (!p.hasDefault || p.component === 'state'))) return [];
    const inputs = e.inputs.map((p, i) => i === message ? '{{message}}' : p.defaultValue);
    const config = {space: spaceUrl, apiName: e.apiName, inputs: JSON.stringify(inputs), outputIndex: String(output)};
    parsePlan(config.inputs, config.apiName, config.outputIndex);
    return [{provider: 'gradio' as const, label: `/${e.apiName}`, config}];
  });
}

// Structured endpoints (for example plan_trip(origin, destination, month, preferences))
// cannot be invoked safely until the operator supplies fixed values for required fields.
// Propose an editable template instead of inventing data. The benchmark prompt is mapped
// only when exactly one semantically suitable free-text field is present.
export function structuredInputRecipes(spaceUrl: string, endpoints: GradioEndpoint[]): ConnectorRecipe[] {
  return endpoints.flatMap(e => {
    const message = structuredMessageIndex(e), output = assistantOutputIndex(e);
    if (message < 0 || output < 0 || e.inputs.some(p => p.component === 'state')) return [];
    if (e.inputs.some((p, i) => i !== message && !p.hasDefault && !(p.type === 'string' || p.type === 'str'))) return [];
    const inputs = e.inputs.map((p, i) => {
      if (i === message) return '{{message}}';
      if (p.hasDefault) return p.defaultValue;
      return `<REQUIRED:${p.name}>`;
    });
    const config = {space: spaceUrl, apiName: e.apiName, inputs: JSON.stringify(inputs), outputIndex: String(output)};
    parsePlan(config.inputs, config.apiName, config.outputIndex);
    return [{provider: 'gradio' as const, label: `/${e.apiName} (structured input template)`, config}];
  });
}

async function readJson(target: ValidatedHttpsTarget, io: ConnectorIO): Promise<unknown> {
  const response = await io.request(target, {method: 'GET', headers: {Accept: 'application/json'}, timeoutMs: 8000, maxResponseBytes: 1000000});
  if (response.status < 200 || response.status >= 300) throw new Error('Public Gradio schema is unavailable. Use manual configuration.');
  try {return JSON.parse(response.text);} catch {throw new Error('Invalid Gradio schema. Use manual configuration.');}
}
export async function resolveGradioSpace(raw: string, io: ConnectorIO): Promise<ValidatedHttpsTarget> {
  const url = new URL(raw.trim());
  // Do not silently strip credentials, queries, paths or ports before security validation.
  if (url.search || url.hash) throw new Error('Use a Space URL without query parameters or fragments.');
  const target = await io.pin(url.href, URL_OPTIONS);
  if (url.hostname === 'huggingface.co') {
    const match = url.pathname.match(/^\/spaces\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)\/?$/);
    if (!match) throw new Error('Use a Hugging Face /spaces/owner/name URL.');
    const metadata = object(await readJson({...target, url: new URL(`/api/spaces/${match[1]}/${match[2]}`, url.origin)}, io));
    if (metadata.sdk !== 'gradio' || typeof metadata.host !== 'string') throw new Error('Space does not expose a Gradio host. Use its direct public URL.');
    const host = new URL(metadata.host);
    if (!host.hostname.endsWith('.hf.space') || host.pathname !== '/' || host.search || host.hash) throw new Error('Unsupported Space host.');
    return io.pin(host.href, URL_OPTIONS);
  }
  if (url.pathname !== '/') throw new Error('Discovery currently supports root-mounted Gradio apps. Manual configuration remains available.');
  return target;
}
export async function discoverGradio(raw: string, io: ConnectorIO = publicConnectorIO): Promise<GradioDiscovery> {
  const space = await resolveGradioSpace(raw, io);
  const schema = await readJson({...space, url: new URL('/gradio_api/info', space.url.origin)}, io);
  const endpoints = parseGradioSchema(schema);
  let workflows: ConnectorRecipe[] = [];
  if (endpoints.some(e => e.apiName === 'log_user_message') && endpoints.some(e => e.apiName === 'interact_with_agent')) {
    try {
      const config = await readJson({...space, url: new URL('/config', space.url.origin)}, io);
      workflows = statefulRecipes(space.url.origin, endpoints, config, assistantOutputIndex);
    } catch { /* Optional graph unavailable: preserve manual fallback and supported single steps. */ }
  }
  // Never suggest calling one half of a stateful chain as a standalone agent.
  const standalone = endpoints.filter(e => e.apiName !== 'log_user_message' && e.apiName !== 'interact_with_agent');
  const direct = singleStepRecipes(space.url.origin, standalone);
  const directNames = new Set(direct.map(recipe => recipe.config.apiName));
  const structured = structuredInputRecipes(space.url.origin, standalone.filter(e => !directNames.has(e.apiName)));
  const recipes = [...workflows, ...direct, ...structured];
  const hasRequired = recipes.some(recipe => recipe.config.inputs.includes('<REQUIRED:'));
  return {provider: 'gradio', spaceUrl: space.url.origin, endpoints, recipes,
    status: recipes.length === 1 ? 'proposed' : recipes.length > 1 ? 'ambiguous' : 'manual_required',
    message: recipes.length === 1 && hasRequired ? 'Structured input template found. Fill every REQUIRED placeholder with a fixed value, then test the connection.' : recipes.length === 1 ? 'Review the proposed recipe and test the connection before benchmarking.' : recipes.length > 1 ? 'Several endpoints fit. Choose and test a recipe; BENCHRX has not selected one.' : 'No unambiguous supported recipe was found. Use the exposed schema to configure manually.'};
}
