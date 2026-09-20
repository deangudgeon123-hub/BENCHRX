import type {ConnectorDiscovery} from '../../connectors/types.ts';
import type {ConnectorProvider} from './interface.ts';

export type OpenAIAgentRun = {
  status: 'completed' | 'in_progress' | 'queued' | 'failed' | 'cancelled' | 'incomplete';
  assistantText?: string;
  runId?: string;
  retryAfterMs?: number;
  toolCalls?: number;
};
export type OpenAIAgentsRuntime = {
  validateAgent(agentId: string): Promise<void>;
  start(agentId: string, message: string, options: {streaming: boolean}): Promise<OpenAIAgentRun>;
  poll?(runId: string): Promise<OpenAIAgentRun>;
};
type OpenAIAgentsConnection = {agentId: string; streaming: boolean};
type OpenAIAgentsResult = OpenAIAgentRun;

class OpenAIAgentsConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

class UnconfiguredOpenAIAgentsRuntime implements OpenAIAgentsRuntime {
  private unavailable(): never {
    throw new OpenAIAgentsConfigError(
      'credential_storage_required',
      'OpenAI Agents is not configured: BENCHRX needs a private server-side credential binding before live OpenAI agent execution can be enabled.',
    );
  }
  async validateAgent(_agentId: string): Promise<void> { this.unavailable(); }
  async start(_agentId: string, _message: string, _options: {streaming: boolean}): Promise<OpenAIAgentRun> { return this.unavailable(); }
}

function validateAgentId(raw: string): string {
  const value = raw.trim();
  if (!value || value.length > 256 || /\s/.test(value)) throw new OpenAIAgentsConfigError('invalid_agent_id', 'Enter a valid OpenAI Agent ID.');
  return value;
}

function terminalFailure(status: OpenAIAgentRun['status']): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'incomplete';
}

export function createOpenAIAgentsConnector(
  runtime: OpenAIAgentsRuntime = new UnconfiguredOpenAIAgentsRuntime(),
): ConnectorProvider<OpenAIAgentsConnection, OpenAIAgentsResult> {
  return {
    id: 'openai-agents',
    async discover(): Promise<ConnectorDiscovery> {
      return {
        provider: 'openai-agents',
        status: 'manual_required',
        message: 'Enter the reusable OpenAI Agent ID. Live execution also requires a private server-side credential binding.',
        recipes: [{label: 'OpenAI Agent', provider: 'openai-agents', config: {}, kind: 'template'}],
      };
    },
    async validate(config) {
      const agentId = validateAgentId(config.get('agentId') ?? '');
      await runtime.validateAgent(agentId);
      return {agentId, streaming: config.get('streaming') !== '0'};
    },
    async invoke(connection, input) {
      if (!input.hasMessage || typeof input.message !== 'string') throw new OpenAIAgentsConfigError('invalid_message', 'OpenAI Agents requires a string message.');
      let result = await runtime.start(connection.agentId, input.message, {streaming: connection.streaming});
      const deadline = Date.now() + 60000;
      while ((result.status === 'in_progress' || result.status === 'queued') && result.runId && runtime.poll && Date.now() < deadline) {
        const delay = Math.max(0, Math.min(result.retryAfterMs ?? 250, 2000));
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        result = await runtime.poll(result.runId);
      }
      if (result.status === 'in_progress' || result.status === 'queued') {
        throw new OpenAIAgentsConfigError('run_timeout', 'OpenAI Agent execution did not complete before the BENCHRX timeout.');
      }
      return result;
    },
    extract(_connection, result) {
      return result.status === 'completed' ? String(result.assistantText ?? '').trim() : '';
    },
    diagnose(_connection, result) {
      if (terminalFailure(result.status)) return {
        outcome: 'connector_failure', status: 502, error: 'OpenAI Agent execution failed.',
        diagnostics: {stage: 'run', code: `run_${result.status}`},
      };
      const text = result.status === 'completed' ? String(result.assistantText ?? '').trim() : '';
      if (!text) return {
        outcome: 'unobserved_response', status: 502, error: 'OpenAI Agent run contained no assistant-authored result.',
        diagnostics: {stage: 'extract', code: 'empty_assistant_output'},
      };
      return {outcome: 'observed_response', status: 200};
    },
    diagnoseError(error) {
      if (error instanceof OpenAIAgentsConfigError) return {
        stage: error.code === 'credential_storage_required' || error.code === 'invalid_agent_id' ? 'validation' : 'run',
        code: error.code,
      };
      return {stage: 'transport', code: 'request_failed'};
    },
    metadata(connection) {
      return {agentId: connection.agentId, streaming: connection.streaming, runtime: 'openai-agents-api'};
    },
  };
}
export const openAIAgentsConnector = createOpenAIAgentsConnector();
