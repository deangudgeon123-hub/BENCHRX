import {randomUUID} from 'node:crypto';
import {publicConnectorIO, type ConnectorIO, type ConnectorProvider} from './interface.ts';
import type {ValidatedHttpsTarget} from '../pinned-https.ts';
import {RuntimeConnectorError as Fault, object, parseJson, pinRuntime, publicRuntimeUrl, checkHttp, requestLimits, sseFrames, runtimeDiagnostic, textDiagnosis, childTarget} from './runtime-common.ts';

type A2ASkill = {
  id: string;
  name: string;
  description: string;
  inputModes: string[];
  outputModes: string[];
};
type Connection = {
  target: ValidatedHttpsTarget;
  version: '0.3' | '1.0';
  streaming: boolean;
  binding: 'JSONRPC' | 'HTTP+JSON';
  tenant?: string;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2ASkill[];
};
type Result = {text: string};
type PreparedInput = {kind: 'text' | 'data'; value: unknown; outputModes: string[]};

const terminal = new Set(['completed', 'failed', 'canceled', 'rejected', 'input-required', 'auth-required']);
const supportedInputModes = new Set(['text/plain', 'application/json']);
const supportedOutputModes = new Set(['text/plain', 'application/json']);
const safeProbePattern = /(catalog|catalogue|capabilit|status|health|help|info|schema|metadata|list|describe|discover|reference|methodolog)/i;

const stateOf = (value: unknown) => String(value ?? '').replace(/^TASK_STATE_/, '').toLowerCase().replace(/_/g, '-');
const stringModes = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function normalizedData(value: unknown): string {
  const encoded = JSON.stringify(canonical(value));
  return encoded === undefined ? '' : encoded;
}

function partsOutput(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map(raw => {
    const part = object(raw);
    const kind = part.kind;
    if ((kind === undefined || kind === 'text') && typeof part.text === 'string') return part.text;
    if ((kind === undefined || kind === 'data') && Object.prototype.hasOwnProperty.call(part, 'data')) return normalizedData(part.data);
    return '';
  }).filter(Boolean).join('\n');
}

function assistantOutput(value: unknown): string {
  const message = object(value);
  return ['agent', 'ROLE_AGENT'].includes(String(message.role)) ? partsOutput(message.parts) : '';
}

function decode(values: unknown[], modern: boolean, id: string, rpc: boolean): {done: boolean; text: string} {
  let done = false, text = '', taskId = '';
  const artifacts = new Map<string, string>();
  for (const value of values) {
    const envelope = object(value);
    if (rpc && (envelope.jsonrpc !== '2.0' || envelope.id !== id)) throw new Fault('malformed_response');
    if (envelope.error) throw new Fault('protocol_error');
    const result = rpc ? object(envelope.result) : envelope;

    const wrappedMessage = object(result.message);
    const directModernMessage = modern && Array.isArray(result.parts) && typeof result.role === 'string' ? result : {};
    const message = modern
      ? (Object.keys(wrappedMessage).length ? wrappedMessage : directModernMessage)
      : result.kind === 'message' ? result : {};

    if (Object.keys(message).length) {
      if (taskId || done) throw new Fault('malformed_response');
      text = assistantOutput(message);
      done = true;
      continue;
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
      if (Array.isArray(task.artifacts)) {
        for (const rawArtifact of task.artifacts) {
          const artifact = object(rawArtifact);
          if (typeof artifact.artifactId !== 'string') throw new Fault('malformed_response');
          artifacts.set(artifact.artifactId, partsOutput(artifact.parts));
        }
      }
      text = assistantOutput(object(task.status).message) || (Array.isArray(task.history) ? assistantOutput(task.history.at(-1)) : '');
    }

    if (current === artifactUpdate) {
      const artifact = object(current.artifact);
      if (typeof artifact.artifactId !== 'string' || !artifact.artifactId) throw new Fault('malformed_response');
      artifacts.set(
        artifact.artifactId,
        (current.append === true ? artifacts.get(artifact.artifactId) ?? '' : '') + partsOutput(artifact.parts),
      );
    } else {
      const status = object(current.status);
      const state = stateOf(status.state);
      if (terminal.has(state)) {
        if (state !== 'completed') throw new Fault(state === 'input-required' || state === 'auth-required' ? 'unsupported_capability' : 'failed_run');
        done = true;
        text = assistantOutput(status.message) || text;
      }
    }
  }
  return {done, text: [...artifacts.values()].filter(Boolean).join('\n').trim() || text.trim()};
}

function effectiveModes(skill: A2ASkill | undefined, direction: 'input' | 'output', defaults: string[]): string[] {
  const explicit = direction === 'input' ? skill?.inputModes : skill?.outputModes;
  return explicit && explicit.length ? explicit : defaults;
}

function supportsSkillMode(skill: A2ASkill, mode: string, defaults: string[]): boolean {
  return effectiveModes(skill, 'input', defaults).includes(mode);
}

function acceptedOutputs(connection: Connection, skill?: A2ASkill): string[] {
  const modes = effectiveModes(skill, 'output', connection.defaultOutputModes).filter(mode => supportedOutputModes.has(mode));
  if (!modes.length) throw new Fault('unsupported_capability', 'validation');
  return modes;
}

function safeDataProbeSkill(connection: Connection): A2ASkill | undefined {
  return connection.skills
    .filter(skill => supportsSkillMode(skill, 'application/json', connection.defaultInputModes))
    .map(skill => ({
      skill,
      score: safeProbePattern.test([skill.id, skill.name, skill.description].join(' ')) ? 1 : 0,
    }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))[0]?.skill;
}

function prepareInput(connection: Connection, input: {hasMessage: boolean; message: unknown; connectionTest: boolean; structuredProbe: boolean}): PreparedInput {
  if (input.structuredProbe) {
    const dataSkill = safeDataProbeSkill(connection);
    if (!dataSkill) throw new Fault('unsupported_capability', 'structured_probe');
    return {kind: 'data', value: {skill: dataSkill.id}, outputModes: acceptedOutputs(connection, dataSkill)};
  }

  if (input.connectionTest) {
    const textSkill = connection.skills.find(skill => supportsSkillMode(skill, 'text/plain', connection.defaultInputModes));
    if (textSkill) {
      return {
        kind: 'text',
        value: 'Reply briefly to confirm this BENCHRX A2A connection test was received.',
        outputModes: acceptedOutputs(connection, textSkill),
      };
    }

    const dataSkill = safeDataProbeSkill(connection);
    if (dataSkill) {
      return {
        kind: 'data',
        value: {skill: dataSkill.id},
        outputModes: acceptedOutputs(connection, dataSkill),
      };
    }

    if (connection.skills.length === 0 && connection.defaultInputModes.includes('text/plain')) {
      return {
        kind: 'text',
        value: 'Reply briefly to confirm this BENCHRX A2A connection test was received.',
        outputModes: acceptedOutputs(connection),
      };
    }

    throw new Fault('unsupported_capability', 'connection_test');
  }

  if (!input.hasMessage) throw new Fault('invalid_config', 'input');

  if (typeof input.message === 'string') {
    const textSkills = connection.skills.filter(skill => supportsSkillMode(skill, 'text/plain', connection.defaultInputModes));
    const allSkillsExplicitlyNonText = connection.skills.length > 0 &&
      connection.skills.every(skill => skill.inputModes.length > 0 && !skill.inputModes.includes('text/plain'));
    if (allSkillsExplicitlyNonText || (!connection.defaultInputModes.includes('text/plain') && textSkills.length === 0)) {
      throw new Fault('unsupported_capability', 'input');
    }
    return {kind: 'text', value: input.message, outputModes: acceptedOutputs(connection, textSkills[0])};
  }

  const data = input.message;
  let selectedSkill: A2ASkill | undefined;
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const skillId = (data as Record<string, unknown>).skill;
    if (typeof skillId === 'string') selectedSkill = connection.skills.find(skill => skill.id === skillId);
  }
  selectedSkill ??= connection.skills.find(skill => supportsSkillMode(skill, 'application/json', connection.defaultInputModes));

  const jsonSupported = selectedSkill
    ? supportsSkillMode(selectedSkill, 'application/json', connection.defaultInputModes)
    : connection.defaultInputModes.includes('application/json');
  if (!jsonSupported) throw new Fault('unsupported_capability', 'input');

  return {kind: 'data', value: data, outputModes: acceptedOutputs(connection, selectedSkill)};
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
    if (typeof card.name !== 'string' || !card.name.trim() || !card.capabilities || !Array.isArray(card.skills) || !Array.isArray(card.defaultInputModes) || !Array.isArray(card.defaultOutputModes)) {
      throw new Fault('malformed_card', 'discovery');
    }

    const defaultInputModes = stringModes(card.defaultInputModes);
    const defaultOutputModes = stringModes(card.defaultOutputModes);
    const skills = card.skills.map(raw => {
      const skill = object(raw);
      return {
        id: typeof skill.id === 'string' ? skill.id.trim() : '',
        name: typeof skill.name === 'string' ? skill.name : '',
        description: typeof skill.description === 'string' ? skill.description : '',
        inputModes: stringModes(skill.inputModes),
        outputModes: stringModes(skill.outputModes),
      };
    }).filter(skill => skill.id);

    const advertisedInputs = [...defaultInputModes, ...skills.flatMap(skill => effectiveModes(skill, 'input', defaultInputModes))];
    const advertisedOutputs = [...defaultOutputModes, ...skills.flatMap(skill => effectiveModes(skill, 'output', defaultOutputModes))];
    if (!advertisedInputs.some(mode => supportedInputModes.has(mode)) || !advertisedOutputs.some(mode => supportedOutputModes.has(mode))) {
      throw new Fault('unsupported_capability', 'discovery');
    }

    const security = card.securityRequirements ?? card.security;
    if (security !== undefined && (!Array.isArray(security) || (security.length > 0 && !security.some(x => Object.keys(object(object(x).schemes ?? x)).length === 0)))) {
      throw new Fault('credentials_required', 'discovery');
    }

    const caps = object(card.capabilities);
    if (Array.isArray(caps.extensions) && caps.extensions.some(x => object(x).required === true)) throw new Fault('unsupported_capability', 'discovery');

    let version: Connection['version'];
    let url: unknown;
    let tenant: string | undefined;
    let binding: Connection['binding'] = 'JSONRPC';

    if (Array.isArray(card.supportedInterfaces)) {
      const selected = card.supportedInterfaces.map(object).find(x => ['JSONRPC', 'HTTP+JSON'].includes(String(x.protocolBinding)) && /^1\.0(?:\.\d+)?$/.test(String(x.protocolVersion)));
      if (!selected) throw new Fault('unsupported_protocol', 'discovery');
      version = '1.0';
      url = selected.url;
      binding = selected.protocolBinding as Connection['binding'];
      if (selected.tenant !== undefined && typeof selected.tenant !== 'string') throw new Fault('malformed_card', 'discovery');
      tenant = selected.tenant as string | undefined;
    } else {
      if (!/^0\.3(?:\.\d+)?$/.test(String(card.protocolVersion))) throw new Fault('unsupported_protocol', 'discovery');
      version = '0.3';
      const choices = [{url: card.url, transport: card.preferredTransport ?? 'JSONRPC'}, ...(Array.isArray(card.additionalInterfaces) ? card.additionalInterfaces.map(object) : [])];
      const selected = choices.find(x => x.transport === 'JSONRPC' || x.transport === 'HTTP+JSON');
      url = selected?.url;
      binding = selected?.transport as Connection['binding'];
    }

    if (typeof url !== 'string') throw new Fault('unsupported_protocol', 'discovery');
    const target = await pinRuntime(io, url);
    const mode = config.get('mode') ?? 'auto';
    if (!['auto', 'sync', 'stream'].includes(mode)) throw new Fault('invalid_config', 'validation');
    if (mode === 'stream' && caps.streaming !== true) throw new Fault('unsupported_capability', 'validation');

    return {
      target,
      version,
      tenant,
      binding,
      streaming: mode !== 'sync' && caps.streaming === true,
      defaultInputModes,
      defaultOutputModes,
      skills,
    };
  }

  return {
    id: 'a2a',
    validate,
    async discover(url) {
      const connection = await validate(new URLSearchParams({target: url}));
      return {
        provider: 'a2a',
        status: 'proposed',
        message: 'A2A ' + connection.version + ' ' + connection.binding + ' available' + (connection.streaming ? ' with streaming' : '') + '.',
        recipes: [{provider: 'a2a', label: 'Discovered A2A agent', config: {target: url, mode: 'auto'}}],
      };
    },
    async invoke(connection, input) {
      if (input.profileProbe) {
        const skillInputs = connection.skills.length
          ? connection.skills.map(skill => effectiveModes(skill, 'input', connection.defaultInputModes))
          : [connection.defaultInputModes];
        const textCapable = skillInputs.some(modes => modes.includes('text/plain'));
        const dataCapable = skillInputs.some(modes => modes.includes('application/json'));
        const safeSkill = safeDataProbeSkill(connection);
        return {text: normalizedData({
          structuredOnly: dataCapable && !textCapable,
          safeProbeAvailable: Boolean(safeSkill),
          safeProbeSkill: safeSkill?.id ?? null,
          skillCount: connection.skills.length,
          protocolVersion: connection.version,
          binding: connection.binding,
        })};
      }
      const prepared = prepareInput(connection, input);
      const rpc = connection.binding === 'JSONRPC';
      const modern = connection.version === '1.0';
      const id = randomUUID();
      const part = prepared.kind === 'text'
        ? (modern ? {text: String(prepared.value), mediaType: 'text/plain'} : {kind: 'text', text: String(prepared.value)})
        : (modern ? {data: prepared.value, mediaType: 'application/json'} : {kind: 'data', data: prepared.value});
      const message = modern
        ? {role: 'ROLE_USER', messageId: randomUUID(), parts: [part]}
        : {kind: 'message', role: 'user', messageId: randomUUID(), parts: [part]};
      const method = modern
        ? connection.streaming ? 'SendStreamingMessage' : 'SendMessage'
        : connection.streaming ? 'message/stream' : 'message/send';
      const parse = (text: string) => decode(sseFrames(text).map(frame => parseJson(frame.data)), modern, id, rpc);
      const params = {
        message,
        ...(connection.tenant !== undefined ? {tenant: connection.tenant} : {}),
        configuration: {
          acceptedOutputModes: prepared.outputModes,
          ...(modern ? {returnImmediately: false} : {blocking: true}),
        },
      };
      const target = rpc ? connection.target : childTarget(connection.target, connection.streaming ? '/message:stream' : '/message:send');
      const response = await io.request(target, {
        ...requestLimits,
        method: 'POST',
        headers: {
          'Content-Type': rpc ? 'application/json' : 'application/a2a+json',
          Accept: connection.streaming ? 'text/event-stream' : 'application/json',
          'A2A-Version': connection.version,
        },
        body: JSON.stringify(rpc ? {jsonrpc: '2.0', id, method, params} : params),
        ...(connection.streaming ? {completeWhen: (text: string) => {try {return parse(text).done;} catch {return true;}}} : {}),
      });
      checkHttp(response.status);
      const result = connection.streaming ? parse(response.text) : decode([parseJson(response.text)], modern, id, rpc);
      if (!result.done) throw new Fault('incomplete_run');
      return {text: result.text};
    },
    extract: (_connection, result) => result.text,
    diagnose: (_connection, result) => textDiagnosis(result.text),
    diagnoseError: runtimeDiagnostic,
    metadata: connection => ({
      binding: connection.binding,
      protocolVersion: connection.version,
      streaming: connection.streaming,
      skillCount: connection.skills.length,
      inputModes: connection.defaultInputModes,
      outputModes: connection.defaultOutputModes,
      safeStructuredProbe: Boolean(safeDataProbeSkill(connection)),
    }),
  };
}
export const a2aConnector = createA2AConnector();
