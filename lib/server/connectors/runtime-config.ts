import {publicRuntimeUrl, RuntimeConnectorError} from './runtime-common.ts';

export type RuntimeConnectorType = 'a2a' | 'langgraph';
export function isRuntimeConnector(type: string): type is RuntimeConnectorType {
  return type === 'a2a' || type === 'langgraph';
}
// Only non-secret, allowlisted connection configuration may be persisted in endpoints.
export function runtimeConfig(body: Record<string, unknown>): URLSearchParams {
  const type = String(body.connectionType);
  if (!isRuntimeConnector(type)) throw new RuntimeConnectorError('invalid_config', 'validation');

  if (type === 'langgraph') {
    const baseUrl = publicRuntimeUrl(String(body.langGraphBaseUrl ?? body.baseUrl ?? '').trim()).href;
    const assistantId = String(body.langGraphAssistantId ?? body.assistantId ?? '').trim();
    const mode = String(body.langGraphMode ?? body.mode ?? 'stateless') === 'threaded' ? 'threaded' : 'stateless';
    const streaming = body.langGraphStreaming === false || String(body.streaming ?? '') === '0' ? '0' : '1';
    const config = new URLSearchParams({baseUrl, mode, streaming});
    if (assistantId) config.set('assistantId', assistantId);
    return config;
  }

  const target = publicRuntimeUrl(String(body.targetUrl ?? body.a2aBaseUrl ?? '').trim()).href;
  const mode = String(body.mode ?? 'auto');
  if (!['auto', 'sync', 'stream'].includes(mode)) throw new RuntimeConnectorError('invalid_config', 'validation');
  return new URLSearchParams({target, mode});
}
export function runtimeEndpoint(body: Record<string, unknown>, origin: string): URL {
  const config = runtimeConfig(body);
  const endpoint = new URL(`/api/adapters/${body.connectionType}`, origin);
  endpoint.search = config.toString();
  return endpoint;
}
