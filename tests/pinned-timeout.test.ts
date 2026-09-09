import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {pinnedHttpsRequest, PinnedRequestTimeoutError} from '../lib/server/pinned-https.ts';

test('pinned HTTPS absolute deadline survives continuous SSE heartbeats and remains bounded', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const response = Object.assign(new EventEmitter(), {statusCode: 200, headers: {'content-type': 'text/event-stream'}});
  const events = new EventEmitter();
  const req = Object.assign(events, {
    setTimeout: () => {}, write: () => {}, end: () => {},
    destroy(error: Error) { events.emit('error', error); },
  });
  t.mock.method(https, 'request', (_url: URL, options: any, callback: (r: unknown) => void) => {
    assert.equal(options.servername, 'example.com');
    options.lookup('example.com', {}, (_error: unknown, ip: string, family: number) => {
      assert.equal(ip, '93.184.216.34'); assert.equal(family, 4);
    });
    callback(response); return req;
  });
  syncBuiltinESMExports();
  try {
    const promise = pinnedHttpsRequest({url: new URL('https://example.com/events'), hostname: 'example.com', address: '93.184.216.34', family: 4}, {method: 'GET', timeoutMs: 45000, maxResponseBytes: 1000000});
    const rejected = assert.rejects(promise, PinnedRequestTimeoutError);
    for (let i = 0; i < 3; i++) {
      response.emit('data', Buffer.from('event: heartbeat\ndata: null\n\n'));
      t.mock.timers.tick(15000);
    }
    await rejected;
  } finally {t.mock.restoreAll(); syncBuiltinESMExports();}
});
