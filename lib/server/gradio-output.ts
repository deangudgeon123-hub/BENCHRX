import {GradioInvocationError} from './gradio-errors.ts';
// Protocol extraction is independent of prompts, expected answers and endpoint URLs.
export function parseSseComplete(text: string): unknown {
  for (const block of text.split(/\r?\n\r?\n/).slice(0,-1)) {
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (event === 'error') throw new GradioInvocationError('job', 'job_failed');
    if (event === 'complete') {
      try { return JSON.parse(data); }
      catch { throw new GradioInvocationError('completion', 'invalid_json'); }
    }
  }
  throw new GradioInvocationError('completion', 'incomplete_stream');
}

function extractMarkdownTranscriptAssistant(text: string): string | null {
  let trimmed = text.trim();
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
  // If a rendered transcript has multiple turns, inspect only the final user turn.
  // A trailing user turn must never fall back to an older assistant response.
  const turns = [...trimmed.matchAll(/(?:^|\r?\n\r?\n)#### You\r?\n\r?\n> /gu)];
  const lastTurn = turns[turns.length - 1];
  if (lastTurn) trimmed = trimmed.slice(lastTurn.index).trimStart();
  const boundary = /\r?\n\r?\n#### ([^\r\n]+)\r?\n\r?\n/u.exec(trimmed);
  if (!boundary || boundary[1].trim().toLowerCase() === 'you') return '';
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

// /queue/data multiplexes session messages. Only this submitted event can complete the step.
export function parseQueueSseComplete(text: string, eventId: string): unknown {
  for (const block of text.split(/\r?\n\r?\n/).slice(0, -1)) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) continue;
    let message;
    try {message = JSON.parse(data);} catch {throw new GradioInvocationError('completion', 'invalid_json');}
    if (!message || typeof message !== 'object') continue;
    if (message.msg === 'unexpected_error') throw new GradioInvocationError('poll', 'transport');
    if (message.event_id !== eventId) continue;
    if (message.success === false) throw new GradioInvocationError('job', 'job_failed');
    if (message.msg === 'process_completed' && message.success === true) {
      if (!Array.isArray(message.output?.data)) throw new GradioInvocationError('output', 'invalid_output');
      return message.output.data;
    }
  }
  throw new GradioInvocationError('completion', 'incomplete_stream');
}
