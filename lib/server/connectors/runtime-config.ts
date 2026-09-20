import {publicRuntimeUrl, RuntimeConnectorError} from './runtime-common.ts';

export function isRuntimeConnector(type: string): type is 'a2a' {return type === 'a2a';}
// Only non-secret, allowlisted connection configuration may be persisted in endpoints.
export function runtimeConfig(body: Record<string, unknown>): URLSearchParams {
  const type = String(body.connectionType);
  if (!isRuntimeConnector(type)) throw new RuntimeConnectorError('invalid_config', 'validation');
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
