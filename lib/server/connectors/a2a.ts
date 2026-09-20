import {randomUUID} from 'node:crypto';
import {publicConnectorIO, type ConnectorIO, type ConnectorProvider} from './interface.ts';
import type {ValidatedHttpsTarget} from '../pinned-https.ts';
import {RuntimeConnectorError as Fault, object, parseJson, pinRuntime, publicRuntimeUrl, checkHttp, requestLimits, sseFrames, runtimeDiagnostic, textDiagnosis, childTarget} from './runtime-common.ts';

type Connection = {target: ValidatedHttpsTarget; version: '0.3' | '1.0'; streaming: boolean; binding: 'JSONRPC' | 'HTTP+JSON'; tenant?: string};
type Result = {text: string};
const terminal = new Set(['completed', 'failed', 'canceled', 'rejected', 'input-required', 'auth-required']);
const stateOf = (value: unknown) => String(value ?? '').replace(/^TASK_STATE_/, '').toLowerCase().replace(/_/g, '-');
const partsText = (value: unknown) => Array.isArray(value) ? value.map(p => object(p)).filter(p => (p.kind === undefined || p.kind === 'text') && typeof p.text === 'string').map(p => p.text).join('') : '';
const assistantText = (value: unknown) => {const m = object(value); return ['agent', 'ROLE_AGENT'].includes(String(m.role)) ? partsText(m.parts) : '';};

function decode(values: unknown[], modern: boolean, id: string, rpc: boolean): {done: boolean; text: string} {
  let done = false, text = '', taskId = '';
  const artifacts = new Map<string, string>();
  for (const value of values) {
    const envelope = object(value);
    if (rpc && (envelope.jsonrpc !== '2.0' || envelope.id !== id)) throw new Fault('malformed_response');
    if (envelope.error) throw new Fault('protocol_error');
    const result = rpc ? object(envelope.result) : envelope;
    const m = modern ? object(result.message) : result.kind === 'message' ? result : {};
    if (Object.keys(m).length) {
      if (taskId || done) throw new Fault('malformed_response');
      text = assistantText(m); done = true; continue;
    }
    const task = modern ? object(result.task) : result.kind === 'task' ? result : {};
    const statusUpdate = modern ? object(result.statusUpdate) : result.kind === 'status-update' ? result : {};
    const artifactUpdate = modern ? object(result.artifactUpdate) : result.kind === 'artifact-update' ? result : {};
    const current = Object.keys(task).length ? task : Object.keys(statusUpdate).length ? statusUpdate : artifactUpdate;
    if (!Object.keys(current).length || done) throw new Fault('malformed_response');
    const currentId = current === task ? task.id : current.taskId;
    if (typeof currentId !== 'string' || !currentId || (taskId && taskId !== currentId)) throw new Fault('malformed_response');
    taskId = currentId;
    if (current === task) {
      artifacts.clear();
      if (Array.isArray(task.artifacts)) for (const a of task.artifacts) {const artifact = object(a); if (typeof artifact.artifactId !== 'string') throw new Fault('malformed_response'); artifacts.set(artifact.artifactId, partsText(artifact.parts));}
      // Prefer the status message; only the final history entry may supply an assistant reply.
      text = assistantText(object(task.status).message) || (Array.isArray(task.history) ? assistantText(task.history.at(-1)) : '');
    }
    if (current === artifactUpdate) {
      const a = object(current.artifact);
      if (typeof a.artifactId !== 'string' || !a.artifactId) throw new Fault('malformed_response');
      artifacts.set(a.artifactId, (current.append === true ? artifacts.get(a.artifactId) ?? '' : '') + partsText(a.parts));
    } else {
      const status = object(current.status), state = stateOf(status.state);
      if (terminal.has(state)) {
        if (state !== 'completed') throw new Fault(state === 'input-required' || state === 'auth-required' ? 'unsupported_capability' : 'failed_run');
        done = true; text = assistantText(status.message) || text;
      }
    }
  }
  return {done, text: [...artifacts.values()].join('\n').trim() || text.trim()};
}

export function createA2AConnector(io: ConnectorIO = publicConnectorIO): ConnectorProvider<Connection, Result> {
  async function validate(config: URLSearchParams): Promise<Connection> {
    const base = publicRuntimeUrl(config.get('target') ?? config.get('baseUrl') ?? '');
    const cardUrl = base.pathname.endsWith('/agent-card.json') ? base : new URL('/.well-known/agent-card.json', base);
    const cardTarget = await pinRuntime(io, cardUrl.href);
    const response = await io.request(cardTarget, {...requestLimits, timeoutMs: 8000, method: 'GET', headers: {Accept: 'application/json'}});
    checkHttp(response.status);
    let card: Record<string, unknown>;
    try {card = object(parseJson(response.text));} catch {throw new Fault('malformed_card', 'discovery');}
    if (typeof card.name !== 'string' || !card.name.trim() || !card.capabilities || !Array.isArray(card.skills) || !Array.isArray(card.defaultInputModes) || !Array.isArray(card.defaultOutputModes)) throw new Fault('malformed_card', 'discovery');
    const security = card.securityRequirements ?? card.security;
    if (security !== undefined && (!Array.isArray(security) || (security.length > 0 && !security.some(x => Object.keys(object(object(x).schemes ?? x)).length === 0)))) throw new Fault('credentials_required', 'discovery');
    const caps = object(card.capabilities);
    if (Array.isArray(caps.extensions) && caps.extensions.some(x => object(x).required === true)) throw new Fault('unsupported_capability', 'discovery');
    if (!card.defaultInputModes.includes('text/plain') || !card.defaultOutputModes.includes('text/plain')) throw new Fault('unsupported_capability', 'discovery');
    let version: Connection['version'], url: unknown, tenant: string | undefined, binding: Connection['binding'] = 'JSONRPC';
    if (Array.isArray(card.supportedInterfaces)) {
      const selected = card.supportedInterfaces.map(object).find(x => ['JSONRPC', 'HTTP+JSON'].includes(String(x.protocolBinding)) && /^1\.0(?:\.\d+)?$/.test(String(x.protocolVersion)));
      if (!selected) throw new Fault('unsupported_protocol', 'discovery');
      version = '1.0'; url = selected.url; binding = selected.protocolBinding as Connection['binding'];
      if (selected.tenant !== undefined && typeof selected.tenant !== 'string') throw new Fault('malformed_card', 'discovery');
      tenant = selected.tenant as string | undefined;
    } else {
      if (!/^0\.3(?:\.\d+)?$/.test(String(card.protocolVersion))) throw new Fault('unsupported_protocol', 'discovery');
      version = '0.3';
      const choices = [{url: card.url, transport: card.preferredTransport ?? 'JSONRPC'}, ...(Array.isArray(card.additionalInterfaces) ? card.additionalInterfaces.map(object) : [])];
      const selected = choices.find(x => x.transport === 'JSONRPC' || x.transport === 'HTTP+JSON');
      url = selected?.url; binding = selected?.transport as Connection['binding'];
    }
    if (typeof url !== 'string') throw new Fault('unsupported_protocol', 'discovery');
    const target = await pinRuntime(io, url); // Agent Card URLs remain untrusted: independently validate and pin.
    const mode = config.get('mode') ?? 'auto';
    if (!['auto', 'sync', 'stream'].includes(mode)) throw new Fault('invalid_config', 'validation');
    if (mode === 'stream' && caps.streaming !== true) throw new Fault('unsupported_capability', 'validation');
    return {target, version, tenant, binding, streaming: mode !== 'sync' && caps.streaming === true};
  }
  return {
    id: 'a2a', validate,
    async discover(url) {
      const c = await validate(new URLSearchParams({target: url}));
      return {provider: 'a2a', status: 'proposed', message: `A2A ${c.version} ${c.binding} available${c.streaming ? ' with streaming' : ''}.`, recipes: [{provider: 'a2a', label: 'Discovered A2A agent', config: {target: url, mode: 'auto'}}]};
    },
    async invoke(c, input) {
      if (!input.hasMessage || typeof input.message !== 'string') throw new Fault('invalid_config', 'input');
      const rpc = c.binding === 'JSONRPC';
      const modern = c.version === '1.0', id = randomUUID();
      const message = modern ? {role: 'ROLE_USER', messageId: randomUUID(), parts: [{text: input.message}]} : {kind: 'message', role: 'user', messageId: randomUUID(), parts: [{kind: 'text', text: input.message}]};
      const method = modern ? c.streaming ? 'SendStreamingMessage' : 'SendMessage' : c.streaming ? 'message/stream' : 'message/send';
      const parse = (text: string) => decode(sseFrames(text).map(f => parseJson(f.data)), modern, id, rpc);
      const params = {message, ...(c.tenant !== undefined ? {tenant: c.tenant} : {}), configuration: {acceptedOutputModes: ['text/plain'], ...(modern ? {returnImmediately: false} : {blocking: true})}};
      const target = rpc ? c.target : childTarget(c.target, c.streaming ? '/message:stream' : '/message:send');
      const response = await io.request(target, {...requestLimits, method: 'POST', headers: {'Content-Type': rpc ? 'application/json' : 'application/a2a+json', Accept: c.streaming ? 'text/event-stream' : 'application/json', 'A2A-Version': c.version},
        body: JSON.stringify(rpc ? {jsonrpc: '2.0', id, method, params} : params),
        ...(c.streaming ? {completeWhen: (text: string) => {try {return parse(text).done;} catch {return true;}}} : {}),
      });
      checkHttp(response.status);
      const result = c.streaming ? parse(response.text) : decode([parseJson(response.text)], modern, id, rpc);
      if (!result.done) throw new Fault('incomplete_run');
      return {text: result.text};
    },
    extract: (_c, r) => r.text,
    diagnose: (_c, r) => textDiagnosis(r.text),
    diagnoseError: runtimeDiagnostic,
    metadata: c => ({binding: c.binding, protocolVersion: c.version, streaming: c.streaming}),
  };
}
export const a2aConnector = createA2AConnector();
