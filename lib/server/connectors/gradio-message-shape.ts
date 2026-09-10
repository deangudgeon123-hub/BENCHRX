const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const keysWithin = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).every(k => allowed.includes(k));

function schemaOfType(raw: unknown, expected: 'object' | 'string' | 'array'): Record<string, unknown> | null {
  const schema = object(raw);
  if (schema.type === expected) return schema;
  if (!Array.isArray(schema.anyOf) || schema.anyOf.length !== 2 ||
      !keysWithin(schema, ['anyOf', 'title', 'description', 'additional_description', 'default']) ||
      (schema.default !== undefined && schema.default !== null && !(expected === 'array' && Array.isArray(schema.default) && schema.default.length === 0))) return null;
  const branches = schema.anyOf.map(object);
  const typed = branches.filter(branch => branch.type === expected);
  const nullable = branches.filter(branch => branch.type === 'null' && keysWithin(branch, ['type', 'title', 'description']));
  return typed.length === 1 && nullable.length === 1 ? typed[0] : null;
}

// Only the standard Gradio MultimodalTextbox wire shape is proven here. Arbitrary
// JSON objects, unresolved root refs and extra validation constraints stay manual.
// Gradio 5.x may express nullable text/files using a two-branch anyOf; accept only
// that exact nullable form. Empty files means text-only invocation, not image support
// or fabricated file data.
export function provenMessageShape(raw: unknown): 'text_files' | null {
  const p = object(raw), s = schemaOfType(p.type, 'object');
  if (String(p.component).toLowerCase() !== 'multimodaltextbox' || !s ||
      !keysWithin(s, ['type', 'title', 'description', 'additional_description', 'properties', 'required', '$defs', 'additionalProperties', 'default']) ||
      (s.default !== undefined && s.default !== null)) return null;
  const props = object(s.properties);
  if (!keysWithin(props, ['text', 'files'])) return null;
  const text = schemaOfType(props.text, 'string'), files = schemaOfType(props.files, 'array');
  if (!text || !files ||
      !keysWithin(text, ['type', 'title', 'description', 'default']) ||
      !keysWithin(files, ['type', 'title', 'description', 'items', 'minItems', 'maxItems', 'default']) ||
      (text.default !== undefined && text.default !== null) ||
      (files.default !== undefined && files.default !== null && !(Array.isArray(files.default) && files.default.length === 0))) return null;
  if (files.minItems !== undefined && files.minItems !== 0) return null;
  if (files.maxItems !== undefined && (!Number.isSafeInteger(files.maxItems) || Number(files.maxItems) < 0)) return null;
  if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some(k => k !== 'text' && k !== 'files'))) return null;
  return 'text_files';
}
