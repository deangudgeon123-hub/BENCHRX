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

function extractMarkdownTranscriptAssistant(text: string): string | null {
  const trimmed = text.trim();
  // Some Gradio apps return a rendered chat transcript as one Markdown string:
  //   #### You
  //
  //   > echoed user text
  //
  //   #### Agent name
  //
  //   assistant-authored text
  // Require the quoted-user shape so arbitrary assistant Markdown is not truncated.
  if (!/^#### You\r?\n\r?\n> /u.test(trimmed)) return null;
  const boundary = /\r?\n\r?\n#### ([^\r\n]+)\r?\n\r?\n/u.exec(trimmed);
  if (!boundary || boundary[1].trim().toLowerCase() === 'you') return null;
  return trimmed.slice((boundary.index ?? 0) + boundary[0].length).trim();
}

function isNonFinalStatus(text: string): boolean {
  // UI progress placeholders are transport state, not authored agent behaviour.
  return /^_Working(?:…|\.\.\.)_$/iu.test(text.trim());
}

export function extractAssistantText(value: unknown): string {
  // A selected string output is explicit connector configuration. For known rendered
  // transcript shape, retain only the assistant-authored section.
  if (typeof value === 'string') {
    const selected = extractMarkdownTranscriptAssistant(value) ?? value.trim();
    return isNonFinalStatus(selected) ? '' : selected;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    // Modern Gradio messages: only the final assistant message, never a user fallback.
    if (value.every((item) => item && typeof item === 'object' && !Array.isArray(item) && 'role' in item)) {
      const last = value[value.length - 1] as {role?: unknown; content?: unknown};
      if (last.role !== 'assistant' || typeof last.content !== 'string') return '';
      const selected = last.content.trim();
      return isNonFinalStatus(selected) ? '' : selected;
    }
    // Legacy chatbot tuples: [user, assistant], assistant may be null while generating.
    if (value.every((item) => Array.isArray(item) && item.length === 2)) {
      const last = value[value.length - 1] as unknown[];
      if (typeof last[1] !== 'string') return '';
      const selected = last[1].trim();
      return isNonFinalStatus(selected) ? '' : selected;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    const message = value as {role?: unknown; content?: unknown};
    if (message.role !== 'assistant' || typeof message.content !== 'string') return '';
    const selected = message.content.trim();
    return isNonFinalStatus(selected) ? '' : selected;
  }
  return '';
}
