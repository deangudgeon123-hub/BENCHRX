import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantOutputDiagnostic, extractAssistantText} from '../lib/server/gradio-output.ts';
import {createGradioConnector} from '../lib/server/connectors/gradio.ts';
import {invokeNormalizedConnector} from '../lib/server/connectors/interface.ts';

test('structural diagnostics distinguish missing evidence without returning content', async t => {
  const marker = 'AUDIT_FAKE_SECRET';
  const cases: [unknown, string][] = [
    ['answer', 'assistant_output'], ['', 'empty_assistant'],
    ['_Working…_', 'progress_placeholder'], ['_Working..._', 'progress_placeholder'],
    [[{role: 'user', content: marker}], 'trailing_user'],
    [[{role: 'assistant', content: marker}, {role: 'user', content: marker}], 'trailing_user'],
    [[[marker, null]], 'empty_assistant'],
    [{role: 'assistant', content: []}, 'unsupported_shape'],
    [{unknown: marker}, 'unsupported_shape'],
    [`#### You\n\n> ${marker}`, 'no_assistant_section'],
    [`#### You\n\n> ${marker}\n\n#### Agent\n\n_Working…_`, 'progress_placeholder'],
  ];
  const logs: unknown[] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => {logs.push(args);});
  const target = {url: new URL('https://example.com'), hostname: 'example.com', address: '93.184.216.34', family: 4 as const};
  for (const [value, code] of cases) {
    assert.equal(assistantOutputDiagnostic(value), code);
    const provider = createGradioConnector({pin: async () => target, request: async (_url, options) => ({
      status: 200, headers: {}, text: options.method === 'POST' ? '{"event_id":"ours"}'
        : `event: complete\ndata: ${JSON.stringify([value])}\n\n`,
    })});
    const result = await invokeNormalizedConnector(provider, new URLSearchParams({space: target.url.href, inputs: '["{{message}}"]'}), {message: marker});
    assert.equal(result.outcome, code === 'assistant_output' ? 'observed_response' : 'unobserved_response');
    if (code !== 'assistant_output') {
      assert.equal(extractAssistantText(value), '');
      assert.equal(result.response, null);
    }
    assert.ok(!JSON.stringify(result).includes(marker));
  }
  assert.ok(!JSON.stringify(logs).includes(marker));
  assert.deepEqual(logs[0], ['BENCHRX Gradio output unavailable', {stage: 'output', code: 'empty_assistant', stepIndex: 0}]);
});
