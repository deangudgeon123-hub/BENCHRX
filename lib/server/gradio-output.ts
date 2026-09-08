// Protocol extraction is independent of prompts, expected answers and endpoint URLs.
export function parseSseComplete(text: string): unknown {
  for (const block of text.split(/\r?\n\r?\n/).slice(0,-1)) {
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (event === 'error') throw new Error('Gradio reported a failed job.');
    if (event === 'complete') {
      try { return JSON.parse(data); }
      catch { throw new Error('Gradio completion payload was not valid JSON.'); }
    }
  }
  throw new Error('Gradio stream ended without a completion event.');
}

export function extractAssistantText(value: unknown): string {
  // A selected string output is explicit connector configuration, not guessed traversal.
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    // Modern Gradio messages: only the final assistant message, never a user fallback.
    if (value.every((item) => item && typeof item === 'object' && !Array.isArray(item) && 'role' in item)) {
      const last = value[value.length - 1] as {role?: unknown; content?: unknown};
      return last.role === 'assistant' && typeof last.content === 'string' ? last.content.trim() : '';
    }
    // Legacy chatbot tuples: [user, assistant], assistant may be null while generating.
    if (value.every((item) => Array.isArray(item) && item.length === 2)) {
      const last = value[value.length - 1] as unknown[];
      return typeof last[1] === 'string' ? last[1].trim() : '';
    }
    return '';
  }
  if (value && typeof value === 'object') {
    const message = value as {role?: unknown; content?: unknown};
    return message.role === 'assistant' && typeof message.content === 'string' ? message.content.trim() : '';
  }
  return '';
}
