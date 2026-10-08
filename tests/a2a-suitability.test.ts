import test from 'node:test';
import assert from 'node:assert/strict';
import {a2aSuitability,A2A_SUITABILITY_MARKER,A2A_SUITABILITY_MESSAGE} from '../lib/connectors/a2a-suitability.ts';

test('one exact reply is only a candidate, never validated readiness',()=>{
 assert.equal(a2aSuitability(` ${A2A_SUITABILITY_MARKER}\n`,['text/plain']).status,'candidate');
 assert.match(a2aSuitability(A2A_SUITABILITY_MARKER,['text/plain']).message,/remains unverified/);
 assert.match(A2A_SUITABILITY_MESSAGE,/harmless/);
 for(const reply of ['help: select a skill','Sidequest project introduction',`${A2A_SUITABILITY_MARKER} and more`,'']) {
  assert.equal(a2aSuitability(reply,['text/plain']).status,'unverified');
 }
});
test('declared non-text input warrants review but does not prove capability or incompetence',()=>{
 assert.equal(a2aSuitability(A2A_SUITABILITY_MARKER,['application/json']).status,'unverified');
 assert.match(a2aSuitability('PRIVATE_OUTPUT',['application/json']).message,/Agent Card/);
 assert.ok(!JSON.stringify(a2aSuitability('PRIVATE_OUTPUT',null)).includes('PRIVATE_OUTPUT'));
 assert.equal(a2aSuitability(A2A_SUITABILITY_MARKER,{malformed:true}).status,'candidate');
});
