import type {ConnectorDiscovery, ProviderId} from '../../connectors/types.ts';
import {pinnedHttpsRequest, validateAndPinPublicHttpsUrl} from '../pinned-https.ts';

export type ConnectorIO = {
  pin: typeof validateAndPinPublicHttpsUrl;
  request: typeof pinnedHttpsRequest;
};
export const publicConnectorIO: ConnectorIO = {pin: validateAndPinPublicHttpsUrl, request: pinnedHttpsRequest};
export type InvocationInput = {hasMessage: boolean; message: unknown};
export type ConnectorOutcome = 'observed_response' | 'unobserved_response' | 'connector_failure';
export type ConnectorDiagnosis = {status: number; outcome: ConnectorOutcome; error?: string};
export type AdapterReply = {status: number; body: Record<string, unknown>};

// Validation prepares a pinned public connection; invoke never rediscovers or changes recipes.
export interface ConnectorProvider<Connection, Result> {
  id: ProviderId;
  discover(url: string): Promise<ConnectorDiscovery>;
  validate(config: URLSearchParams): Promise<Connection>;
  invoke(connection: Connection, input: InvocationInput): Promise<Result>;
  extract(connection: Connection, result: Result): string;
  diagnose(connection: Connection, result: Result): ConnectorDiagnosis;
  metadata(connection: Connection): Record<string, unknown>;
}

// Internal only: classifications come from connector execution, never response-body flags.
export type NormalizedConnectorResponse = {
  provider: ProviderId;
  outcome: ConnectorOutcome;
  response: string | null;
  status: number;
  completed: boolean;
  error?: string;
  metadata: Record<string, unknown>;
};

export async function invokeNormalizedConnector<C, R>(provider: ConnectorProvider<C, R>, config: URLSearchParams, incoming: Record<string, unknown>): Promise<NormalizedConnectorResponse> {
  try {
    const connection = await provider.validate(config);
    const result = await provider.invoke(connection, {
      hasMessage: Object.prototype.hasOwnProperty.call(incoming, 'message'), message: incoming.message,
    });
    const diagnosis = provider.diagnose(connection, result);
    return {provider: provider.id, outcome: diagnosis.outcome, status: diagnosis.status,
      completed: true, response: diagnosis.outcome === 'observed_response' ? provider.extract(connection, result) : null,
      ...(diagnosis.error ? {error: diagnosis.error} : {}), metadata: provider.metadata(connection)};
  } catch {
    // No exception text or upstream payload escapes through this contract.
    return {provider: provider.id, outcome: 'connector_failure', status: 502,
      completed: false, response: null, error: 'Connector execution failed', metadata: {}};
  }
}

export async function invokeConnector<C, R>(provider: ConnectorProvider<C, R>, config: URLSearchParams, incoming: Record<string, unknown>): Promise<AdapterReply> {
  const result = await invokeNormalizedConnector(provider, config, incoming);
  // Preserve the worker protocol. No new body flag can change trusted observation handling.
  return {status: result.status, body: result.response === null ? {error: result.error} : {
    response: result.response, provider: result.provider, ...result.metadata,
  }};
}
