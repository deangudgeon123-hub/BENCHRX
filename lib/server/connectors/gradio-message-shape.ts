const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const keysWithin = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).every(k => allowed.includes(k));

// Only the standard Gradio MultimodalTextbox wire shape is proven here. Arbitrary
// JSON objects, unresolved root refs and extra validation constraints stay manual.
// Empty files means text-only invocation, not image support or fabricated file data.
export function provenMessageShape(raw: unknown): 'text_files' | null {
  const p = object(raw), s = object(p.type), props = object(s.properties);
  if (String(p.component).toLowerCase() !== 'multimodaltextbox' || s.type !== 'object' ||
      !keysWithin(s, ['type', 'title', 'description', 'additional_description', 'properties', 'required', '$defs', 'additionalProperties']) ||
      !keysWithin(props, ['text', 'files'])) return null;
  const text = object(props.text), files = object(props.files);
  if (text.type !== 'string' || files.type !== 'array' ||
      !keysWithin(text, ['type', 'title', 'description']) ||
      !keysWithin(files, ['type', 'title', 'description', 'items', 'minItems', 'maxItems'])) return null;
  if (files.minItems !== undefined && files.minItems !== 0) return null;
  if (files.maxItems !== undefined && (!Number.isSafeInteger(files.maxItems) || Number(files.maxItems) < 0)) return null;
  if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some(k => k !== 'text' && k !== 'files'))) return null;
  return 'text_files';
}
