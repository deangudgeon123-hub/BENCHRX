import type {ConnectorDiscovery, ProviderId} from '../../connectors/types.ts';
import {pinnedHttpsRequest, validateAndPinPublicHttpsUrl} from '../pinned-https.ts';

export type ConnectorIO = {
  pin: typeof validateAndPinPublicHttpsUrl;
  request: typeof pinnedHttpsRequest;
};
export const publicConnectorIO: ConnectorIO = {pin: validateAndPinPublicHttpsUrl, request: pinnedHttpsRequest};
export type InvocationInput = {hasMessage: boolean; message: unknown; connectionTest: boolean};
export type ConnectorOutcome = 'observed_response' | 'unobserved_response' | 'connector_failure';
export type ConnectorDiagnostics = {stage: string; code: string; httpStatus?: number; stepIndex?: number};
export type ConnectorDiagnosis = {status: number; outcome: ConnectorOutcome; error?: string; diagnostics?: ConnectorDiagnostics};
export type AdapterReply = {status: number; body: Record<string, unknown>};

// Validation prepares a pinned public connection; invoke never rediscovers or changes recipes.
export interface ConnectorProvider<Connection, Result> {
  id: ProviderId;
  discover(url: string): Promise<ConnectorDiscovery>;
  validate(config: URLSearchParams): Promise<Connection>;
  invoke(connection: Connection, input: InvocationInput): Promise<Result>;
  extract(connection: Connection, result: Result): string;
  diagnose(connection: Connection, result: Result): ConnectorDiagnosis;
  diagnoseError?(error: unknown): ConnectorDiagnostics | undefined;
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
  diagnostics?: ConnectorDiagnostics;
  metadata: Record<string, unknown>;
};

export async function invokeNormalizedConnector<C, R>(provider: ConnectorProvider<C, R>, config: URLSearchParams, incoming: Record<string, unknown>): Promise<NormalizedConnectorResponse> {
  try {
    const connection = await provider.validate(config);
    const result = await provider.invoke(connection, {
      hasMessage: Object.prototype.hasOwnProperty.call(incoming, 'message'), message: incoming.message,
      connectionTest: incoming._benchrx_connection_test === true,
    });
    const diagnosis = provider.diagnose(connection, result);
    return {provider: provider.id, outcome: diagnosis.outcome, status: diagnosis.status,
      completed: true, response: diagnosis.outcome === 'observed_response' ? provider.extract(connection, result) : null,
      ...(diagnosis.error ? {error: diagnosis.error} : {}),
      ...(diagnosis.diagnostics ? {diagnostics: diagnosis.diagnostics} : {}), metadata: provider.metadata(connection)};
  } catch (error) {
    // No exception text or upstream payload escapes through this contract. A provider may
    // preserve only its fixed, content-free diagnostic fields for operator evidence.
    const diagnostics = provider.diagnoseError?.(error);
    return {provider: provider.id, outcome: 'connector_failure', status: 502,
      completed: false, response: null, error: 'Connector execution failed',
      ...(diagnostics ? {diagnostics} : {}), metadata: {}};
  }
}

export async function invokeConnector<C, R>(provider: ConnectorProvider<C, R>, config: URLSearchParams, incoming: Record<string, unknown>): Promise<AdapterReply> {
  const result = await invokeNormalizedConnector(provider, config, incoming);
  // Preserve the worker protocol. Diagnostics are evidence-only response fields; they
  // never determine trusted observation, completion, status, or scoring.
  return {status: result.status, body: result.response === null ? {
    error: result.error, ...(result.diagnostics ? {diagnostics: result.diagnostics} : {}),
  } : {
    response: result.response, provider: result.provider, ...result.metadata,
  }};
}
