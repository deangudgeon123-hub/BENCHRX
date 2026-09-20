import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAIAgentsConnector, type OpenAIAgentsRuntime} from '../lib/server/connectors/openai-agents.ts';
import {invokeNormalizedConnector} from '../lib/server/connectors/interface.ts';

test('OpenAI Agents provider executes a completed reusable agent run', async () => {
  const runtime: OpenAIAgentsRuntime = {
    async validateAgent(agentId) { assert.equal(agentId, 'agent_fixture'); },
    async start(agentId, message, options) {
      assert.equal(agentId, 'agent_fixture');
      assert.equal(message, 'hello');
      assert.equal(options.streaming, true);
      return {status: 'completed', assistantText: 'agent answer', toolCalls: 1};
    },
  };
  const result = await invokeNormalizedConnector(createOpenAIAgentsConnector(runtime), new URLSearchParams({agentId: 'agent_fixture', streaming: '1'}), {message: 'hello'});
  assert.equal(result.outcome, 'observed_response');
  assert.equal(result.response, 'agent answer');
  assert.equal(result.metadata.runtime, 'openai-agents-api');
});

test('OpenAI Agents provider polls long-running execution to completion', async () => {
  let polls = 0;
  const runtime: OpenAIAgentsRuntime = {
    async validateAgent() {},
    async start() { return {status: 'queued', runId: 'run-1', retryAfterMs: 0}; },
    async poll(runId) {
      assert.equal(runId, 'run-1');
      polls += 1;
      return polls === 1 ? {status: 'in_progress', runId, retryAfterMs: 0} : {status: 'completed', runId, assistantText: 'finished'};
    },
  };
  const result = await invokeNormalizedConnector(createOpenAIAgentsConnector(runtime), new URLSearchParams({agentId: 'agent_fixture'}), {message: 'hello'});
  assert.equal(result.outcome, 'observed_response');
  assert.equal(result.response, 'finished');
  assert.equal(polls, 2);
});

test('OpenAI Agents failures never expose output as observed evidence', async () => {
  const runtime: OpenAIAgentsRuntime = {
    async validateAgent() {},
    async start() { return {status: 'failed', assistantText: 'pretend success'}; },
  };
  const result = await invokeNormalizedConnector(createOpenAIAgentsConnector(runtime), new URLSearchParams({agentId: 'agent_fixture'}), {message: 'hello'});
  assert.equal(result.outcome, 'connector_failure');
  assert.equal(result.response, null);
  assert.equal(result.diagnostics?.code, 'run_failed');
});

test('OpenAI Agents default runtime fails closed until private credentials exist', async () => {
  const result = await invokeNormalizedConnector(createOpenAIAgentsConnector(), new URLSearchParams({agentId: 'agent_fixture'}), {message: 'hello'});
  assert.equal(result.outcome, 'connector_failure');
  assert.equal(result.response, null);
  assert.equal(result.diagnostics?.code, 'credential_storage_required');
});


test('OpenAI Agents compatibility: tool-using completion returns only final assistant text', async () => {
  const runtime: OpenAIAgentsRuntime = {
    async validateAgent() {},
    async start() {
      return {status: 'completed', assistantText: 'final answer after tool', toolCalls: 2};
    },
  };
  const result = await invokeNormalizedConnector(createOpenAIAgentsConnector(runtime), new URLSearchParams({agentId: 'agent_tool_fixture'}), {message: 'use your tool'});
  assert.equal(result.outcome, 'observed_response');
  assert.equal(result.response, 'final answer after tool');
});
