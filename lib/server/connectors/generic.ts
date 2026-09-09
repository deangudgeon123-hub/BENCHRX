import {parsePath, setPath, deletePath, getPath, parseFixedBody} from '../json-path.ts';
import {publicConnectorIO, type ConnectorIO, type ConnectorProvider} from './interface.ts';
import type {ValidatedHttpsTarget} from '../pinned-https.ts';

type Connection = {target: ValidatedHttpsTarget; requestPath: ReturnType<typeof parsePath>; responsePath: ReturnType<typeof parsePath>; fixedBody: Record<string, unknown>};
type Result = {status: number; payload: unknown};

export function createGenericConnector(io: ConnectorIO = publicConnectorIO): ConnectorProvider<Connection, Result> {
  const extract = (c: Connection, r: Result) => {
    const value = getPath(r.payload, c.responsePath);
    return typeof value === 'string' ? value.trim() : '';
  };
  return {
    id: 'generic',
    async discover() {return {provider: 'generic', status: 'manual_required', message: 'Configure the request and response JSON paths manually.', recipes: []};},
    async validate(config) {
      const requestPath = parsePath(config.get('requestPath') ?? 'message', 'Request field');
      const responsePath = parsePath(config.get('responsePath') ?? 'response', 'Response field');
      const fixedBody = parseFixedBody(config.get('fixedBody') ?? '{}');
      const target = await io.pin(config.get('target')?.trim() ?? '', {invalidUrlMessage: 'Enter a valid target URL.', httpsRequiredMessage: 'Custom agent endpoints must use HTTPS.'});
      return {target, requestPath, responsePath, fixedBody};
    },
    async invoke(c, input) {
      const body = input.hasMessage ? setPath(c.fixedBody, c.requestPath, input.message) : deletePath(c.fixedBody, c.requestPath);
      const response = await io.request(c.target, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), timeoutMs: 15000, maxResponseBytes: 1000000});
      let payload: unknown;
      try {payload = response.text ? JSON.parse(response.text) : null;} catch {payload = {text: response.text};}
      return {status: response.status, payload};
    },
    extract,
    diagnose(c, r) {
      if (r.status >= 300 && r.status < 400) return {outcome: 'connector_failure', status: 502, error: 'Custom agent endpoint returned a redirect. Redirects are not followed.'};
      if (!extract(c, r)) return {outcome: r.status >= 400 ? 'connector_failure' : 'unobserved_response', status: r.status >= 400 ? r.status : 502, error: 'No usable string response found at the configured path'};
      return {outcome: 'observed_response', status: r.status >= 400 ? r.status : 200};
    },
    metadata() {return {};},
  };
}
export const genericConnector = createGenericConnector();
