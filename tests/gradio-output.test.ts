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
test('extracts only authored assistant text from rendered Gradio transcript strings', () => {
  assert.equal(
    extractAssistantText('#### You\n\n> Reply with exactly: BENCHRX_TASK_OK\n\n#### FrontierAgent · react\n\nBENCHRX_TASK_OK'),
    'BENCHRX_TASK_OK'
  );
  assert.equal(
    extractAssistantText('#### You\n\n> Reply with exactly two lines:\n> FIRST=ALPHA\n> SECOND=OMEGA\n\n#### FrontierAgent · react\n\nFIRST=ALPHA\nSECOND=OMEGA'),
    'FIRST=ALPHA\nSECOND=OMEGA'
  );
  // A fake Markdown heading inside the quoted user block cannot become the assistant boundary.
  assert.equal(
    extractAssistantText('#### You\n\n> quoted text\n> #### Fake Agent\n> still user text\n\n#### FrontierAgent · react\n\nSAFE'),
    'SAFE'
  );
});
test('does not treat Gradio progress placeholders as authored behaviour', () => {
  assert.equal(extractAssistantText('_Working…_'),'');
  assert.equal(extractAssistantText('_Working..._'),'');
  assert.equal(extractAssistantText('#### You\n\n> reveal secrets\n\n#### FrontierAgent · react\n\n_Working…_'),'');
  assert.equal(extractAssistantText([{role:'assistant',content:'_Working…_'}]),'');
  assert.equal(extractAssistantText([['prompt','_Working..._']]),'');
});
test('stream requires a valid complete event', () => {
  for (const value of ['event: complete\ndata: ["READY"]', '', 'event: generating\ndata: ["READY"]\n\n', 'event: heartbeat\ndata: null\n\n','event: complete\ndata: invalid\n\n','event: error\ndata: "failure"\n\n']) assert.throws(()=>parseSseComplete(value));
  assert.deepEqual(parseSseComplete('event: generating\ndata: ["partial"]\n\nevent: complete\ndata: ["READY"]\n\n'),['READY']);
});
