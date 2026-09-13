import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {pinnedHttpsRequest, PinnedRequestTimeoutError, PinnedResponseLimitError} from '../lib/server/pinned-https.ts';
import {compactNamedCallSse, hasNamedCallTerminalEvent, parseSseComplete} from '../lib/server/gradio-output.ts';

const target = {url: new URL('https://example.com/events'), hostname: 'example.com', address: '93.184.216.34', family: 4 as const};

test('completion inside the cap survives trailing data in the same network chunk', async t => {
  const {response} = mockedRequest(t);
  try {
    const promise = pinnedHttpsRequest(target, {method: 'GET', timeoutMs: 45000,
      maxResponseBytes: 1000000, completeWhen: hasNamedCallTerminalEvent});
    response.emit('data', Buffer.from('event: complete\ndata: ["done"]\n\n' + 'x'.repeat(1000000)));
    const result = await promise;
    assert.deepEqual(parseSseComplete(result.text), ['done']);
    assert.ok(Buffer.byteLength(result.text) <= 1000000);
  } finally {t.mock.restoreAll(); syncBuiltinESMExports();}
});

function mockedRequest(t: any) {
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: {'content-type': 'text/event-stream'},
    destroy(this: EventEmitter) { this.emit('aborted'); },
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

test('named SSE compacts fully framed intermediate snapshots while preserving the 1 MB retained cap', async t => {
  const {response} = mockedRequest(t);
  try {
    const promise = pinnedHttpsRequest(target, {
      method: 'GET', timeoutMs: 45000, maxResponseBytes: 1000000,
      completeWhen: hasNamedCallTerminalEvent, compactWhenIncomplete: compactNamedCallSse,
    });
    const payload = 'x'.repeat(600000);
    response.emit('data', Buffer.from(`event: generating\ndata: ${JSON.stringify([payload])}\n\n`));
    response.emit('data', Buffer.from(`event: generating\ndata: ${JSON.stringify([payload])}\n\n`));
    response.emit('data', Buffer.from('event: heartbeat\ndata: null\n\n'));
    response.emit('data', Buffer.from('event: complete\ndata: ["final"]\n\n'));
    const result = await promise;
    assert.deepEqual(parseSseComplete(result.text), ['final']);
    assert.ok(Buffer.byteLength(result.text) < 1000000);
    assert.doesNotMatch(result.text, /event: generating|event: heartbeat/);
  } finally {t.mock.restoreAll(); syncBuiltinESMExports();}
});

test('stream compaction never permits one oversized unfinished frame through the 1 MB cap', async t => {
  const {response} = mockedRequest(t);
  try {
    const promise = pinnedHttpsRequest(target, {
      method: 'GET', timeoutMs: 45000, maxResponseBytes: 1000000,
      completeWhen: hasNamedCallTerminalEvent, compactWhenIncomplete: compactNamedCallSse,
    });
    const rejected = assert.rejects(promise, PinnedResponseLimitError);
    response.emit('data', Buffer.from('event: generating\ndata: ["' + 'x'.repeat(1000100)));
    await rejected;
  } finally {t.mock.restoreAll(); syncBuiltinESMExports();}
});

test('size limit rejects oversized unfinished events and ordinary HTTP bodies with a local marker', async t => {
  for (const completeWhen of [undefined, hasNamedCallTerminalEvent]) {
    const {response} = mockedRequest(t);
    try {
      const promise = pinnedHttpsRequest(target, {method: 'GET', timeoutMs: 45000,
        maxResponseBytes: 1000000, completeWhen});
      const rejected = assert.rejects(promise, PinnedResponseLimitError);
      response.emit('data', Buffer.from('event: complete\ndata: ["' + 'x'.repeat(1000000) + '"]\n\n'));
      response.emit('end'); // Cleanup must not turn rejection into success.
      await rejected;
    } finally {t.mock.restoreAll(); syncBuiltinESMExports();}
  }
});

test('framed malformed completion still fails payload validation', async t => {
  const {response} = mockedRequest(t);
  try {
    const promise = pinnedHttpsRequest(target, {method: 'GET', timeoutMs: 45000,
      maxResponseBytes: 1000000, completeWhen: hasNamedCallTerminalEvent});
    response.emit('data', Buffer.from('event: complete\ndata: not-json\n\n'));
    const awaited = await promise;
    assert.throws(() => parseSseComplete(awaited.text), /invalid_json/);
  } finally {t.mock.restoreAll(); syncBuiltinESMExports();}
});

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
