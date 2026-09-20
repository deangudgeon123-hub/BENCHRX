import {randomUUID} from 'node:crypto';
import type {ConnectorDiscovery} from '../../connectors/types.ts';
import {PinnedRequestTimeoutError, PinnedResponseLimitError, type ValidatedHttpsTarget} from '../pinned-https.ts';
import {publicConnectorIO, type ConnectorIO, type ConnectorProvider} from './interface.ts';

type LangGraphMode = 'stateless' | 'threaded';
type LangGraphConnection = {base: ValidatedHttpsTarget; assistantId: string; mode: LangGraphMode; streaming: boolean};
type LangGraphResult = {status: number; text: string; streaming: boolean; complete: boolean; protocolError: boolean};

class LangGraphConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function endpoint(base: ValidatedHttpsTarget, path: string): ValidatedHttpsTarget {
  const url = new URL(base.url);
  url.pathname = `${url.pathname.replace(/\/$/, '')}${path}`;
  url.search = '';
  url.hash = '';
  return {...base, url};
}
function parseJson(text: string): unknown {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}
function assistantIdFrom(value: unknown): string {
  const item = record(value);
  return String(item?.assistant_id ?? item?.assistantId ?? item?.id ?? '').trim();
}
async function resolveAssistant(io: ConnectorIO, base: ValidatedHttpsTarget, configured: string): Promise<string> {
  if (configured) return configured;
  const response = await io.request(endpoint(base, '/assistants/search'), {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({limit: 2}),
    timeoutMs: 10000, maxResponseBytes: 256000,
  });
  if (response.status === 401 || response.status === 403) throw new LangGraphConfigError('authentication_required', 'This LangGraph server requires authentication that BENCHRX is not configured to store.');
  if (response.status < 200 || response.status >= 300) throw new LangGraphConfigError('assistant_discovery_failed', 'LangGraph assistant discovery failed; enter an assistant ID manually.');
  const parsed = parseJson(response.text);
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(record(parsed)?.assistants) ? record(parsed)!.assistants as unknown[] : [];
  const ids = rows.map(assistantIdFrom).filter(Boolean);
  if (ids.length === 1) return ids[0];
  if (ids.length > 1) throw new LangGraphConfigError('assistant_ambiguous', 'Multiple LangGraph assistants were discovered; enter the assistant ID to benchmark.');
  throw new LangGraphConfigError('assistant_not_found', 'No LangGraph assistant was discovered; enter an assistant ID manually.');
}
async function validateConnection(io: ConnectorIO, config: URLSearchParams): Promise<LangGraphConnection> {
  const raw = config.get('baseUrl')?.trim() ?? '';
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new LangGraphConfigError('invalid_url', 'Enter a valid LangGraph Agent Server URL.'); }
  if (parsed.protocol !== 'https:') throw new LangGraphConfigError('https_required', 'LangGraph Agent Server URLs must use HTTPS.');
  const base = await io.pin(parsed.toString(), {invalidUrlMessage: 'Enter a valid LangGraph Agent Server URL.', httpsRequiredMessage: 'LangGraph Agent Server URLs must use HTTPS.'});
  const assistantId = await resolveAssistant(io, base, config.get('assistantId')?.trim() ?? '');
  const mode = config.get('mode') === 'threaded' ? 'threaded' : 'stateless';
  const streaming = config.get('streaming') !== '0';
  return {base, assistantId, mode, streaming};
}
function messageContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    const item = record(part);
    return typeof item?.text === 'string' ? item.text : typeof item?.content === 'string' ? item.content : '';
  }).filter(Boolean).join('').trim();
}
function isAssistantMessage(item: Record<string, unknown>): boolean {
  const role = String(item.role ?? '').toLowerCase();
  const type = String(item.type ?? '').toLowerCase();
  const lcId = Array.isArray(item.id) ? item.id.map(String).join('/').toLowerCase() : '';
  return role === 'assistant' || role === 'ai' || type === 'ai' || type === 'aimessage' || lcId.includes('aimessage');
}
function collectAssistantText(value: unknown, out: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectAssistantText(item, out);
    return;
  }
  const item = record(value);
  if (!item) return;
  if (isAssistantMessage(item)) {
    const text = messageContent(item.content);
    if (text) out.push(text);
    return;
  }
  for (const [key, child] of Object.entries(item)) {
    if (key === 'input' || key === 'metadata') continue;
    if (key === 'messages' || key === 'output' || key === 'values' || key === 'agent' || key === 'result' || key === 'data' || key === 'updates') {
      collectAssistantText(child, out);
    }
  }
}
function extractAssistant(value: unknown): string {
  const found: string[] = [];
  collectAssistantText(value, found);
  return found.at(-1)?.trim() ?? '';
}
type SseEvent = {event: string; data: unknown};
function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const frame of text.split(/\r?\n\r?\n/)) {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) continue;
    const raw = dataLines.join('\n');
    let data: unknown = raw;
    try { data = JSON.parse(raw); } catch {}
    events.push({event, data});
  }
  return events;
}
function streamComplete(text: string): boolean {
  return parseSse(text).some((entry) => ['end', 'error'].includes(entry.event.toLowerCase()));
}
function streamAssistant(text: string): string {
  const found: string[] = [];
  for (const entry of parseSse(text)) {
    if (entry.event.toLowerCase() === 'error') continue;
    collectAssistantText(entry.data, found);
  }
  return found.at(-1)?.trim() ?? '';
}
function streamProtocolError(text: string): boolean {
  return parseSse(text).some((entry) => entry.event.toLowerCase() === 'error');
}
function streamEnded(text: string): boolean {
  return parseSse(text).some((entry) => entry.event.toLowerCase() === 'end');
}
async function createThread(io: ConnectorIO, base: ValidatedHttpsTarget): Promise<string> {
  const response = await io.request(endpoint(base, '/threads'), {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}', timeoutMs: 10000, maxResponseBytes: 256000,
  });
  if (response.status < 200 || response.status >= 300) throw new LangGraphConfigError('thread_create_failed', 'LangGraph thread creation failed.');
  const threadId = String(record(parseJson(response.text))?.thread_id ?? '').trim();
  if (!threadId) throw new LangGraphConfigError('thread_create_invalid', 'LangGraph thread creation returned no thread ID.');
  return threadId;
}
export function createLangGraphConnector(io: ConnectorIO = publicConnectorIO): ConnectorProvider<LangGraphConnection, LangGraphResult> {
  return {
    id: 'langgraph',
    async discover(url): Promise<ConnectorDiscovery> {
      const config = new URLSearchParams({baseUrl: url});
      const connection = await validateConnection(io, config);
      return {provider: 'langgraph', status: 'proposed', message: 'Discovered a LangGraph Agent Server assistant.', recipes: [{label: 'LangGraph Agent Server', provider: 'langgraph', config: {baseUrl: url, assistantId: connection.assistantId, mode: 'stateless', streaming: '1'}, kind: 'executable'}]};
    },
    async validate(config) { return validateConnection(io, config); },
    async invoke(connection, input) {
      if (!input.hasMessage || typeof input.message !== 'string') throw new LangGraphConfigError('invalid_message', 'LangGraph requires a string message.');
      const threadId = connection.mode === 'threaded' ? await createThread(io, connection.base) : null;
      const path = threadId
        ? `/threads/${encodeURIComponent(threadId)}/runs/${connection.streaming ? 'stream' : 'wait'}`
        : `/runs/${connection.streaming ? 'stream' : 'wait'}`;
      const response = await io.request(endpoint(connection.base, path), {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          assistant_id: connection.assistantId,
          input: {messages: [{role: 'user', content: input.message}]},
          ...(connection.streaming ? {stream_mode: ['updates', 'values']} : {}),
        }),
        timeoutMs: 60000, maxResponseBytes: 1000000,
        ...(connection.streaming ? {completeWhen: streamComplete} : {}),
      });
      if (connection.streaming) return {
        status: response.status, text: response.text, streaming: true,
        complete: streamEnded(response.text), protocolError: streamProtocolError(response.text),
      };
      return {status: response.status, text: response.text, streaming: false, complete: true, protocolError: false};
    },
    extract(_connection, result) {
      return result.streaming ? streamAssistant(result.text) : extractAssistant(parseJson(result.text));
    },
    diagnose(_connection, result) {
      if (result.status >= 300 && result.status < 400) return {outcome: 'connector_failure', status: 502, error: 'LangGraph endpoint returned a redirect.', diagnostics: {stage: 'invoke', code: 'redirect', httpStatus: result.status}};
      if (result.status >= 400) return {outcome: 'connector_failure', status: result.status, error: 'LangGraph upstream request failed.', diagnostics: {stage: 'invoke', code: 'upstream_http_error', httpStatus: result.status}};
      if (result.protocolError) return {outcome: 'connector_failure', status: 502, error: 'LangGraph run failed.', diagnostics: {stage: 'run', code: 'failed_run'}};
      if (result.streaming && !result.complete) return {outcome: 'connector_failure', status: 502, error: 'LangGraph stream ended before completion.', diagnostics: {stage: 'stream', code: 'incomplete_stream'}};
      const text = result.streaming ? streamAssistant(result.text) : extractAssistant(parseJson(result.text));
      if (!text) return {outcome: 'unobserved_response', status: 502, error: 'LangGraph run contained no assistant-authored result.', diagnostics: {stage: 'extract', code: 'empty_assistant_output'}};
      return {outcome: 'observed_response', status: 200};
    },
    diagnoseError(error) {
      if (error instanceof PinnedRequestTimeoutError) return {stage: 'transport', code: 'timeout'};
      if (error instanceof PinnedResponseLimitError) return {stage: 'transport', code: 'response_limit'};
      if (error instanceof LangGraphConfigError) return {stage: 'validation', code: error.code};
      return {stage: 'transport', code: 'request_failed'};
    },
    metadata(connection) { return {assistantId: connection.assistantId, mode: connection.mode, streaming: connection.streaming}; },
  };
}
export const langGraphConnector = createLangGraphConnector();
