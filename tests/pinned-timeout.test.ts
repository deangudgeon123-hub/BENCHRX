import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {pinnedHttpsRequest, PinnedRequestTimeoutError} from '../lib/server/pinned-https.ts';

const target = {url: new URL('https://example.com/events'), hostname: 'example.com', address: '93.184.216.34', family: 4 as const};

function mockedRequest(t: any) {
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: {'content-type': 'text/event-stream'},
    destroy() { this.emit('aborted'); },
  });
  const events = new EventEmitter();
  const req = Object.assign(events, {
    setTimeout: () => {}, write: () => {}, end: () => {},
    destroy(error?: Error) { if (error) events.emit('error', error); },
  });
  t.mock.method(https, 'request', (_url: URL, options: any, callback: (r: unknown) => void) => {
    assert.equal(options.servername, 'example.com');
    options.lookup('example.com', {}, (_error: unknown, ip: string, family: number) => {
      assert.equal(ip, '93.184.216.34'); assert.equal(family, 4);
    });
    callback(response); return req;
  });
  syncBuiltinESMExports();
  return {response, req};
}

test('pinned HTTPS absolute deadline survives continuous SSE heartbeats and remains bounded', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {response} = mockedRequest(t);
  try {
    const promise = pinnedHttpsRequest(target, {method: 'GET', timeoutMs: 45000, maxResponseBytes: 1000000});
    const rejected = assert.rejects(promise, PinnedRequestTimeoutError);
    for (let i = 0; i < 3; i++) {
      response.emit('data', Buffer.from('event: heartbeat\ndata: null\n\n'));
      t.mock.timers.tick(15000);
    }
    await rejected;
  } finally {t.mock.restoreAll(); syncBuiltinESMExports();}
});

test('pinned HTTPS can finish on a complete SSE event before EOF and ignore the cleanup abort', async t => {
  const {response} = mockedRequest(t);
  try {
    const promise = pinnedHttpsRequest(target, {
      method: 'GET', timeoutMs: 45000, maxResponseBytes: 1000000,
      completeWhen: text => text.includes('event: complete\ndata: ["done"]\n\n'),
    });
    response.emit('data', Buffer.from('event: heartbeat\ndata: null\n\n'));
    response.emit('data', Buffer.from('event: complete\ndata: ["done"]\n\n'));
    const result = await promise;
    assert.equal(result.status, 200);
    assert.match(result.text, /event: complete/);
  } finally {t.mock.restoreAll(); syncBuiltinESMExports();}
});

test('pinned HTTPS still rejects an abort before protocol completion', async t => {
  const {response} = mockedRequest(t);
  try {
    const promise = pinnedHttpsRequest(target, {
      method: 'GET', timeoutMs: 45000, maxResponseBytes: 1000000,
      completeWhen: text => text.includes('event: complete\n'),
    });
    response.emit('data', Buffer.from('event: heartbeat\ndata: null\n\n'));
    const rejected = assert.rejects(promise, /Upstream response aborted/);
    response.emit('aborted');
    await rejected;
  } finally {t.mock.restoreAll(); syncBuiltinESMExports();}
});
