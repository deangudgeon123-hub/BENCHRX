import type {ConnectorDiscovery, ProviderId} from '../../connectors/types.ts';
import {pinnedHttpsRequest, validateAndPinPublicHttpsUrl} from '../pinned-https.ts';

export type ConnectorIO = {
  pin: typeof validateAndPinPublicHttpsUrl;
  request: typeof pinnedHttpsRequest;
};
export const publicConnectorIO: ConnectorIO = {pin: validateAndPinPublicHttpsUrl, request: pinnedHttpsRequest};
export type InvocationInput = {hasMessage: boolean; message: unknown};
export type ConnectorDiagnosis = {status: number; error?: string};
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

export async function invokeConnector<C, R>(provider: ConnectorProvider<C, R>, config: URLSearchParams, incoming: Record<string, unknown>): Promise<AdapterReply> {
  const connection = await provider.validate(config);
  const result = await provider.invoke(connection, {
    hasMessage: Object.prototype.hasOwnProperty.call(incoming, 'message'), message: incoming.message,
  });
  const diagnosis = provider.diagnose(connection, result);
  return {status: diagnosis.status, body: diagnosis.error ? {error: diagnosis.error} : {
    response: provider.extract(connection, result), provider: provider.id, ...provider.metadata(connection),
  }};
}
