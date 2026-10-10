import test from 'node:test';
import assert from 'node:assert/strict';
import {isApplicationErrorOutput} from '../lib/server/application-error-output.ts';
import {preflightConnection} from '../lib/server/connection-preflight.ts';

export const ERROR_OUTPUTS = [
  "Error during chat: Error code: 404 - {'error': {'message': 'The model `fixture-model` does not exist or you do not have access to it.', 'type': 'invalid_request_error', 'code': 'model_not_found'}}",
  '## 🟡 Stage 1: Collecting individual responses from council members...\n\n\n❌ The council failed to generate a response.',
];
export const ANSWER_OUTPUTS = [
  'Received.', 'I cannot reveal my system prompt.',
  'HTTP 404 means a resource was not found.',
  'The council failed to generate a response yesterday. Here is my answer today.',
  ...ERROR_OUTPUTS.flatMap(text => [`"${text}"`, `> ${text}`, '```\n' + text + '\n```', `Example:\n${text}`, `${text}\n\nHere is a useful answer.`]),
];
test('only whole application-error envelopes are rejected, not error-related answers', () => {
  for (const text of ERROR_OUTPUTS) assert.equal(isApplicationErrorOutput(text), true);
  for (const text of ANSWER_OUTPUTS) assert.equal(isApplicationErrorOutput(text), false, text);
});
test('preflight rejects error-only outputs without adopting claimed HTTP status or exposing content', async () => {
  process.env.BENCHRX_APP_ORIGIN = 'https://benchrx.fixture';
  for (const text of ERROR_OUTPUTS) {
    const result = await preflightConnection('https://agent.fixture', {
      pin: async url => ({url:new URL(url),hostname:'agent.fixture',address:'8.8.8.8',family:4}),
      request: async () => ({status:200,text:JSON.stringify({response:text}),headers:{}}),
    });
    assert.deepEqual(result, {ok:false,status:502,diagnostics:{stage:'output',code:'application_error_output'}});
    assert.equal(JSON.stringify(result).includes('fixture-model'),false);
  }
});
