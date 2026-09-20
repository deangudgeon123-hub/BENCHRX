import {PinnedRequestTimeoutError, PinnedResponseLimitError, type ValidatedHttpsTarget} from '../pinned-https.ts';
import type {ConnectorIO, ConnectorDiagnostics, ConnectorDiagnosis} from './interface.ts';

export type RuntimeCode = 'invalid_config' | 'malformed_card' | 'unsupported_protocol' | 'unsupported_capability' | 'credentials_required' | 'upstream_http_error' | 'malformed_response' | 'protocol_error' | 'incomplete_run' | 'failed_run' | 'timeout' | 'response_limit' | 'network_error' | 'assistant_required';
export class RuntimeConnectorError extends Error {
  readonly code: RuntimeCode;
  readonly stage: string;
  readonly httpStatus?: number;
  constructor(code: RuntimeCode, stage = 'invocation', httpStatus?: number) {
    super(code); this.code = code; this.stage = stage; this.httpStatus = httpStatus;
  }
}
export function runtimeDiagnostic(error: unknown): ConnectorDiagnostics {
  if (error instanceof RuntimeConnectorError) return {stage: error.stage, code: error.code, ...(error.httpStatus ? {httpStatus: error.httpStatus} : {})};
  return {stage: 'transport', code: error instanceof PinnedRequestTimeoutError ? 'timeout' : error instanceof PinnedResponseLimitError ? 'response_limit' : 'network_error'};
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function parseJson(text: string): unknown {
  try {return JSON.parse(text);} catch {throw new RuntimeConnectorError('malformed_response');}
}
export function publicRuntimeUrl(raw: string): URL {
  let url: URL;
  try {url = new URL(raw);} catch {throw new RuntimeConnectorError('invalid_config', 'validation');}
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')) throw new RuntimeConnectorError('invalid_config', 'validation');
  return url;
}
export async function pinRuntime(io: ConnectorIO, raw: string): Promise<ValidatedHttpsTarget> {
  const url = publicRuntimeUrl(raw);
  return io.pin(url.href, {invalidUrlMessage: 'Invalid endpoint', httpsRequiredMessage: 'Public HTTPS required'});
}
export function childTarget(target: ValidatedHttpsTarget, path: string): ValidatedHttpsTarget {
  const url = new URL(target.url.href);
  url.pathname = url.pathname.replace(/\/$/, '') + path;
  return {...target, url};
}
export function checkHttp(status: number) {
  if (status < 200 || status >= 300) throw new RuntimeConnectorError('upstream_http_error', 'transport', status);
}
export const requestLimits = {timeoutMs: 30000, maxResponseBytes: 1000000};
export function remaining(deadline: number): number {
  const ms = deadline - Date.now();
  if (ms <= 0) throw new RuntimeConnectorError('timeout');
  return ms;
}
export type SseFrame = {event: string; data: string};
// Only blank-line terminated frames are complete. EOF never upgrades a partial result.
export function sseFrames(text: string): SseFrame[] {
  return text.replace(/\r\n/g, '\n').split('\n\n').slice(0, -1).flatMap(frame => {
    const lines = frame.split('\n');
    const data = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
    return data ? [{event: lines.find(l => l.startsWith('event:'))?.slice(6).trim() ?? 'message', data}] : [];
  });
}
export function textDiagnosis(text: string): ConnectorDiagnosis {
  return text.trim() ? {outcome: 'observed_response', status: 200} : {outcome: 'unobserved_response', status: 502, error: 'No final assistant text', diagnostics: {stage: 'extraction', code: 'assistant_required'}};
}
