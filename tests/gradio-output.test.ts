import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAssistantText, parseSseComplete } from '../lib/server/gradio-output.ts';

test('never uses user/system/arbitrary object data as assistant reply', () => {
  for (const value of [[{role:'user',content:'READY'}],{role:'user',content:'READY'},{text:'READY'},[['READY',null]],['READY'],[{role:'assistant',content:'old'},{role:'user',content:'new'}]]) assert.equal(extractAssistantText(value),'');
});
test('extracts only supported explicit assistant outputs', () => {
  assert.equal(extractAssistantText(' READY '),'READY');
  assert.equal(extractAssistantText([{role:'user',content:'hi'},{role:'assistant',content:'READY'}]),'READY');
  assert.equal(extractAssistantText([['hi','READY']]),'READY');
});
test('stream requires a valid complete event', () => {
  for (const value of ['', 'event: generating\ndata: ["READY"]\n\n', 'event: heartbeat\ndata: null\n\n','event: complete\ndata: invalid\n\n','event: error\ndata: "failure"\n\n']) assert.throws(()=>parseSseComplete(value));
  assert.deepEqual(parseSseComplete('event: generating\ndata: ["partial"]\n\nevent: complete\ndata: ["READY"]\n\n'),['READY']);
});
