import {randomUUID} from 'node:crypto';
import type {ConnectorDiscovery} from '../../connectors/types.ts';
import {PinnedRequestTimeoutError, PinnedResponseLimitError, type ValidatedHttpsTarget} from '../pinned-https.ts';
import {publicConnectorIO, type ConnectorIO, type ConnectorProvider} from './interface.ts';

type A2ABinding = 'JSONRPC' | 'HTTP+JSON';
type A2AInterface = {url: string; binding: A2ABinding; protocolVersion: string; tenant?: string};
type A2AConnection = {target: ValidatedHttpsTarget; binding: A2ABinding; protocolVersion: string; tenant?: string; streaming: boolean};
type A2AResult = {status: number; payload: unknown; streaming: boolean; terminal: boolean; protocolError: boolean; failedState: boolean};

class A2AConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function cardUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new A2AConfigError('invalid_url', 'Enter a valid A2A HTTPS URL.'); }
  if (url.protocol !== 'https:') throw new A2AConfigError('https_required', 'A2A endpoints must use HTTPS.');
  if (url.pathname.endsWith('/.well-known/agent-card.json')) return url.toString();
  return new URL('/.well-known/agent-card.json', url.origin).toString();
}
function securityRequired(card: Record<string, unknown>): boolean {
  const current = Array.isArray(card.securityRequirements) ? card.securityRequirements : [];
  const legacy = Array.isArray(card.security) ? card.security : [];
  return [...current, ...legacy].some((entry) => {
    const value = record(entry);
    return value !== null && Object.keys(value).length > 0;
  });
}
function requiredExtensionUnsupported(card: Record<string, unknown>): boolean {
  const capabilities = record(card.capabilities);
  const extensions = capabilities && Array.isArray(capabilities.extensions) ? capabilities.extensions : [];
  return extensions.some((entry) => record(entry)?.required === true);
}
function selectInterface(card: Record<string, unknown>): A2AInterface {
  const current = Array.isArray(card.supportedInterfaces) ? card.supportedInterfaces : [];
  for (const raw of current) {
    const item = record(raw);
    const binding = String(item?.protocolBinding ?? '').toUpperCase();
    const url = String(item?.url ?? '').trim();
    if (url && (binding === 'JSONRPC' || binding === 'HTTP+JSON')) return {
      url, binding: binding as A2ABinding,
      protocolVersion: String(item?.protocolVersion ?? '1.0').trim() || '1.0',
      ...(typeof item?.tenant === 'string' && item.tenant ? {tenant: item.tenant} : {}),
    };
  }
  const legacyUrl = String(card.url ?? '').trim();
  const preferred = String(card.preferredTransport ?? 'JSONRPC').toUpperCase();
  if (legacyUrl && (preferred === 'JSONRPC' || preferred === 'HTTP+JSON')) return {
    url: legacyUrl, binding: preferred as A2ABinding,
    protocolVersion: String(card.protocolVersion ?? '0.3').trim() || '0.3',
  };
  const additional = Array.isArray(card.additionalInterfaces) ? card.additionalInterfaces : [];
  for (const raw of additional) {
    const item = record(raw);
    const binding = String(item?.transport ?? '').toUpperCase();
    const url = String(item?.url ?? '').trim();
    if (url && (binding === 'JSONRPC' || binding === 'HTTP+JSON')) return {
      url, binding: binding as A2ABinding,
      protocolVersion: String(card.protocolVersion ?? '0.3').trim() || '0.3',
    };
  }
  throw new A2AConfigError('unsupported_transport', 'Agent Card does not declare a supported JSONRPC or HTTP+JSON interface.');
}
function parseCard(text: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new A2AConfigError('malformed_agent_card', 'A2A Agent Card is not valid JSON.'); }
  const card = record(parsed);
  if (!card || !String(card.name ?? '').trim()) throw new A2AConfigError('malformed_agent_card', 'A2A Agent Card is missing required fields.');
  if (securityRequired(card)) throw new A2AConfigError('authentication_required', 'This A2A agent requires authentication that BENCHRX is not configured to store.');
  if (requiredExtensionUnsupported(card)) throw new A2AConfigError('required_extension_unsupported', 'This A2A agent requires an unsupported protocol extension.');
  return card;
}
async function resolveConnection(io: ConnectorIO, raw: string): Promise<A2AConnection> {
  const discovery = await io.pin(cardUrl(raw), {invalidUrlMessage: 'Enter a valid A2A Agent Card URL.', httpsRequiredMessage: 'A2A Agent Cards must use HTTPS.'});
  const response = await io.request(discovery, {method: 'GET', timeoutMs: 10000, maxResponseBytes: 256000});
  if (response.status < 200 || response.status >= 300) throw new A2AConfigError('agent_card_http_error', 'A2A Agent Card discovery failed.');
  const card = parseCard(response.text);
  const selected = selectInterface(card);
  const target = await io.pin(selected.url, {invalidUrlMessage: 'Agent Card contains an invalid interface URL.', httpsRequiredMessage: 'A2A interfaces must use HTTPS.'});
  return {target, binding: selected.binding, protocolVersion: selected.protocolVersion, ...(selected.tenant ? {tenant: selected.tenant} : {}), streaming: record(card.capabilities)?.streaming === true};
}
function partsText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts.map((part) => typeof record(part)?.text === 'string' ? String(record(part)!.text) : '').filter(Boolean).join('');
}
function messageText(value: unknown): string {
  const message = record(value);
  if (!message) return '';
  const role = String(message.role ?? '').toUpperCase();
  if (role !== 'ROLE_AGENT' && role !== 'AGENT') return '';
  return partsText(message.parts).trim();
}
function artifactText(value: unknown): string {
  const artifact = record(value);
  return artifact ? partsText(artifact.parts).trim() : '';
}
function stateOf(value: unknown): string {
  const item = record(value);
  const status = record(item?.status);
  return String(status?.state ?? '').toUpperCase();
}
const terminalStates = new Set(['TASK_STATE_COMPLETED','TASK_STATE_FAILED','TASK_STATE_CANCELED','TASK_STATE_CANCELLED','TASK_STATE_REJECTED','TASK_STATE_INPUT_REQUIRED','TASK_STATE_AUTH_REQUIRED','COMPLETED','FAILED','CANCELED','CANCELLED','REJECTED','INPUT-REQUIRED','AUTH-REQUIRED']);
const failedStates = new Set(['TASK_STATE_FAILED','TASK_STATE_CANCELED','TASK_STATE_CANCELLED','TASK_STATE_REJECTED','FAILED','CANCELED','CANCELLED','REJECTED']);
function unwrap(value: unknown): unknown {
  const item = record(value);
  return item && Object.prototype.hasOwnProperty.call(item, 'result') ? item.result : value;
}
function extractValue(value: unknown): string {
  const item = record(unwrap(value));
  if (!item) return '';
  if (item.message) { const text = messageText(item.message); if (text) return text; }
  if (item.artifact) { const text = artifactText(item.artifact); if (text) return text; }
  if (item.artifactUpdate) { const text = artifactText(record(item.artifactUpdate)?.artifact); if (text) return text; }
  if (item.statusUpdate) { const text = messageText(record(record(item.statusUpdate)?.status)?.message); if (text) return text; }
  if (item.task) return extractValue(item.task);
  const directMessage = messageText(item); if (directMessage) return directMessage;
  if (Array.isArray(item.artifacts)) {
    const text = item.artifacts.map(artifactText).filter(Boolean).join('');
    if (text) return text.trim();
  }
  const statusText = messageText(record(item.status)?.message); if (statusText) return statusText;
  if (Array.isArray(item.history)) for (let i = item.history.length - 1; i >= 0; i -= 1) {
    const text = messageText(item.history[i]); if (text) return text;
  }
  return '';
}
function protocolError(value: unknown): boolean {
  const item = record(value);
  return Boolean(item && item.error && !item.result);
}
function terminalInfo(value: unknown): {terminal: boolean; failed: boolean} {
  const item = record(unwrap(value));
  if (!item) return {terminal: false, failed: false};
  if (item.message || messageText(item)) return {terminal: true, failed: false};
  if (item.task) return terminalInfo(item.task);
  if (item.statusUpdate) return terminalInfo(item.statusUpdate);
  if (protocolError(value)) return {terminal: true, failed: true};
  const state = stateOf(item);
  return {terminal: terminalStates.has(state), failed: failedStates.has(state)};
}
function parseSse(text: string): unknown[] {
  const events: unknown[] = [];
  for (const frame of text.split(/\r?\n\r?\n/)) {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) continue;
    try { events.push(JSON.parse(data)); } catch { return []; }
  }
  return events;
}
function streamComplete(text: string): boolean {
  return parseSse(text).some((event) => terminalInfo(event).terminal || protocolError(event));
}
function extractStream(text: string): string {
  const events = parseSse(text);
  const chunks: string[] = []; let latest = '';
  for (const event of events) {
    const item = record(unwrap(event)); const update = record(item?.artifactUpdate);
    if (update) { const chunk = artifactText(update.artifact); if (chunk) chunks.push(chunk); }
    const value = extractValue(event); if (value) latest = value;
  }
  return chunks.length ? chunks.join('').trim() : latest.trim();
}
function operationTarget(connection: A2AConnection, operation: 'message:send' | 'message:stream'): ValidatedHttpsTarget {
  if (connection.binding === 'JSONRPC') return connection.target;
  const url = new URL(connection.target.url); url.pathname = `${url.pathname.replace(/\/$/, '')}/${operation}`;
  return {...connection.target, url};
}
function requestBody(connection: A2AConnection, message: string): Record<string, unknown> {
  const current = connection.protocolVersion.startsWith('1.');
  const params: Record<string, unknown> = {
    ...(connection.tenant ? {tenant: connection.tenant} : {}),
    message: current ? {messageId: randomUUID(), role: 'ROLE_USER', parts: [{text: message}]} : {messageId: randomUUID(), role: 'user', parts: [{kind: 'text', text: message}], kind: 'message'},
    configuration: current ? {returnImmediately: false, acceptedOutputModes: ['text/plain']} : {blocking: true, acceptedOutputModes: ['text/plain']},
  };
  if (connection.binding === 'HTTP+JSON') return params;
  return {jsonrpc: '2.0', id: randomUUID(), method: current ? (connection.streaming ? 'SendStreamingMessage' : 'SendMessage') : (connection.streaming ? 'message/stream' : 'message/send'), params};
}
export function createA2AConnector(io: ConnectorIO = publicConnectorIO): ConnectorProvider<A2AConnection, A2AResult> {
  return {
    id: 'a2a',
    async discover(url): Promise<ConnectorDiscovery> {
      const connection = await resolveConnection(io, url);
      return {provider: 'a2a', status: 'proposed', message: `Discovered A2A ${connection.binding} ${connection.protocolVersion} interface.`, recipes: [{label: 'A2A Agent Card', provider: 'a2a', config: {baseUrl: url}, kind: 'executable'}]};
    },
    async validate(config) { return resolveConnection(io, config.get('baseUrl')?.trim() ?? ''); },
    async invoke(connection, input) {
      if (!input.hasMessage || typeof input.message !== 'string') throw new A2AConfigError('invalid_message', 'A2A requires a string message.');
      const streaming = connection.streaming;
      const response = await io.request(operationTarget(connection, streaming ? 'message:stream' : 'message:send'), {
        method: 'POST',
        headers: {'Content-Type': connection.binding === 'HTTP+JSON' ? 'application/a2a+json' : 'application/json', 'A2A-Version': connection.protocolVersion},
        body: JSON.stringify(requestBody(connection, input.message)), timeoutMs: 60000, maxResponseBytes: 1000000,
        ...(streaming ? {completeWhen: streamComplete} : {}),
      });
      if (streaming) {
        const events = parseSse(response.text);
        const info = events.reduce((acc, event) => { const next = terminalInfo(event); return {terminal: acc.terminal || next.terminal, failed: acc.failed || next.failed}; }, {terminal: false, failed: false});
        return {status: response.status, payload: response.text, streaming: true, terminal: info.terminal, failedState: info.failed, protocolError: events.some(protocolError)};
      }
      let payload: unknown = null;
      try { payload = response.text ? JSON.parse(response.text) : null; } catch {}
      const info = terminalInfo(payload);
      return {status: response.status, payload, streaming: false, terminal: info.terminal, failedState: info.failed, protocolError: protocolError(payload)};
    },
    extract(_connection, result) { return result.streaming ? extractStream(String(result.payload ?? '')) : extractValue(result.payload); },
    diagnose(_connection, result) {
      if (result.status >= 300 && result.status < 400) return {outcome: 'connector_failure', status: 502, error: 'A2A endpoint returned a redirect.', diagnostics: {stage: 'invoke', code: 'redirect', httpStatus: result.status}};
      if (result.status >= 400) return {outcome: 'connector_failure', status: result.status, error: 'A2A upstream request failed.', diagnostics: {stage: 'invoke', code: 'upstream_http_error', httpStatus: result.status}};
      if (result.protocolError) return {outcome: 'connector_failure', status: 502, error: 'A2A protocol returned an error.', diagnostics: {stage: 'protocol', code: 'protocol_error'}};
      if (result.streaming && !result.terminal) return {outcome: 'connector_failure', status: 502, error: 'A2A stream ended before a terminal response.', diagnostics: {stage: 'stream', code: 'incomplete_stream'}};
      if (result.failedState) return {outcome: 'connector_failure', status: 502, error: 'A2A task ended unsuccessfully.', diagnostics: {stage: 'protocol', code: 'terminal_failure'}};
      const text = result.streaming ? extractStream(String(result.payload ?? '')) : extractValue(result.payload);
      if (!text) return {outcome: 'unobserved_response', status: 502, error: 'A2A response contained no assistant-authored text.', diagnostics: {stage: 'extract', code: 'empty_assistant_output'}};
      return {outcome: 'observed_response', status: 200};
    },
    diagnoseError(error) {
      if (error instanceof PinnedRequestTimeoutError) return {stage: 'transport', code: 'timeout'};
      if (error instanceof PinnedResponseLimitError) return {stage: 'transport', code: 'response_limit'};
      if (error instanceof A2AConfigError) return {stage: 'validation', code: error.code};
      return {stage: 'transport', code: 'request_failed'};
    },
    metadata(connection) { return {binding: connection.binding, protocolVersion: connection.protocolVersion, streaming: connection.streaming}; },
  };
}
export const a2aConnector = createA2AConnector();
