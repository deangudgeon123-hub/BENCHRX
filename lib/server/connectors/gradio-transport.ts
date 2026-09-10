// Public capability evidence, never a guessed version or an upstream-supplied URL.
// All network paths remain fixed and use the existing pinned HTTPS target.
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function namedCallCapability(info: unknown, apiName: string, count: number): string[] | null {
  const e = object(object(object(info).named_endpoints)['/' + apiName]);
  if (e.api_visibility === 'private' || e.api_visibility === 'undocumented' || !Array.isArray(e.parameters) || e.parameters.length !== count || count > 32) return null;
  const snippet = object(e.code_snippets).bash;
  if (typeof snippet !== 'string' || snippet.length > 16384 || !snippet.includes(`/gradio_api/call/v2/${apiName}`)) return null;
  const names = e.parameters.map(p => object(p).parameter_name);
  if (names.some(n => typeof n !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(n) || ['__proto__', 'prototype', 'constructor'].includes(n)) || new Set(names).size !== names.length) return null;
  return names as string[];
}

export function queueCallCapability(info: unknown, config: unknown, apiName: string, count: number): number | null {
  const e = object(object(object(info).named_endpoints)['/' + apiName]), c = object(config);
  if (e.api_visibility !== 'public' || !Array.isArray(e.parameters) || e.parameters.length !== count || count > 32) return null;
  if (c.api_prefix !== '/gradio_api' || c.enable_queue !== true || !/^sse_v[123]$/.test(String(c.protocol)) ||
      !Array.isArray(c.dependencies) || c.dependencies.length > 128) return null;
  const matches = c.dependencies.map(object).filter(d => typeof d.api_name === 'string' && d.api_name.replace(/^\//, '') === apiName);
  if (matches.length !== 1) return null;
  const d = matches[0];
  if (d.api_visibility !== 'public' || d.queue !== true || !Array.isArray(d.inputs) || d.inputs.length !== count || d.inputs.some(id => !Number.isSafeInteger(id)) || !Number.isSafeInteger(d.id) || Number(d.id) < 0) return null;
  return Number(d.id);
}
