import test from 'node:test';
import assert from 'node:assert/strict';
import {createGradioConnector} from '../lib/server/connectors/gradio.ts';
import {invokeNormalizedConnector} from '../lib/server/connectors/interface.ts';

const target = {
  url: new URL('https://gradio6-demo.hf.space'),
  hostname: 'gradio6-demo.hf.space',
  address: '93.184.216.34',
  family: 4 as const,
};

test('single-step legacy 404 selects the public queued capability without guessing a v2 route', async () => {
  const seen: string[] = [];
  const provider = createGradioConnector({
    pin: async () => target,
    request: async (t, o) => {
      seen.push(`${o.method} ${t.url.pathname}`);
      if (o.method === 'POST' && t.url.pathname === '/gradio_api/call/ask_council') {
        return {status: 404, headers: {}, text: ''};
      }
      if (o.method === 'GET' && t.url.pathname === '/gradio_api/info') {
        return {status: 200, headers: {}, text: JSON.stringify({named_endpoints: {
          '/ask_council': {api_visibility: 'public', parameters: [{parameter_name: 'question'}], returns: [{parameter_name: 'output'}]},
        }})};
      }
      if (o.method === 'GET' && t.url.pathname === '/config') {
        return {status: 200, headers: {}, text: JSON.stringify({api_prefix: '/gradio_api', protocol: 'sse_v3', enable_queue: true, dependencies: [
          {id: 7, api_name: 'ask_council', api_visibility: 'public', queue: true, inputs: [1], outputs: [2]},
        ]})};
      }
      if (o.method === 'POST' && t.url.pathname === '/gradio_api/queue/join') {
        const body = JSON.parse(o.body!);
        assert.equal(body.fn_index, 7);
        assert.deepEqual(body.data, ['fixture question']);
        assert.equal(typeof body.session_hash, 'string');
        return {status: 200, headers: {}, text: '{"event_id":"event-6"}'};
      }
      if (o.method === 'GET' && t.url.pathname === '/gradio_api/queue/data') {
        assert.ok(t.url.searchParams.get('session_hash'));
        return {status: 200, headers: {}, text: `data: ${JSON.stringify({msg: 'process_completed', event_id: 'event-6', success: true, output: {data: ['Council answer']}})}\n\n`};
      }
      throw new Error(`Unexpected request ${o.method} ${t.url.pathname}`);
    },
  });

  const result = await invokeNormalizedConnector(
    provider,
    new URLSearchParams({space: target.url.href, apiName: 'ask_council', inputs: '["{{message}}"]', outputIndex: '0'}),
    {message: 'fixture question'},
  );

  assert.equal(result.outcome, 'observed_response');
  assert.equal(result.response, 'Council answer');
  assert.deepEqual(seen, [
    'POST /gradio_api/call/ask_council',
    'GET /gradio_api/info',
    'GET /config',
    'POST /gradio_api/queue/join',
    'GET /gradio_api/queue/data',
  ]);
});
