import type {GradioEndpoint, GradioParameter} from '../../connectors/types.ts';

const normalize = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const MESSAGE_ROLES = new Set([
  'message', 'user message', 'prompt', 'text', 'text input', 'query', 'question', 'user question',
  'input', 'user input', 'user query', 'request', 'instructions', 'task',
  'description', 'preference', 'preferences', 'requirement', 'requirements',
  'context', 'detail', 'details',
]);
// Control/configuration fields must never become benchmark-message inputs merely
// because they happen to be the only string. This also applies to misleading labels.
const CONFIG_FIELD = /api.?key|token|secret|password|credential|authorization|bearer|model|engine|backend|provider|system|selector/i;
const FIXED_FIELD = /^(origin|destination|month|city|country|region|language|option(?: [a-z0-9]+)?|choice(?: [a-z0-9]+)?)$/;

export function isSensitiveParameter(p: Pick<GradioParameter, 'name' | 'label'>): boolean {
  return /api.?key|token|secret|password|credential|authorization|bearer/i.test(p.name + ' ' + p.label);
}

export function isTextMessageParameter(p: GradioParameter): boolean {
  return /^(string|str)$/.test(p.type) && !p.state && p.hidden !== true &&
    /^(textbox|text|textarea)?$/.test(p.component) &&
    !CONFIG_FIELD.test(p.name) && !CONFIG_FIELD.test(p.label);
}

export type MessageInference = {
  status: 'selected' | 'ambiguous' | 'manual_required';
  candidates: number[];
  index: number;
  basis: 'semantic_field' | 'single_text_endpoint' | 'none';
};

export function inferMessageInput(e: GradioEndpoint): MessageInference {
  const eligible = e.inputs.map((p, i) => ({p, i})).filter(({p}) => isTextMessageParameter(p));
  const strong = eligible.filter(({p}) => MESSAGE_ROLES.has(normalize(p.name)) || MESSAGE_ROLES.has(normalize(p.label)));
  if (strong.length === 1) return {status: 'selected', candidates: [strong[0].i], index: strong[0].i, basis: 'semantic_field'};
  if (strong.length > 1) return {status: 'ambiguous', candidates: strong.map(x => x.i), index: -1, basis: 'none'};
  // A sole free-text parameter on an agent-shaped endpoint is useful evidence;
  // several unnamed strings (or a known fixed field) are not interchangeable prompts.
  if (eligible.length === 1 && e.inputs.length === 1 && e.likelyAgent && !FIXED_FIELD.test(normalize(eligible[0].p.name))) {
    return {status: 'selected', candidates: [eligible[0].i], index: eligible[0].i, basis: 'single_text_endpoint'};
  }
  return {status: eligible.length > 1 ? 'ambiguous' : 'manual_required', candidates: eligible.map(x => x.i), index: -1, basis: 'none'};
}
