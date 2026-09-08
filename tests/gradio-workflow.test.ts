import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlan,executeGradioPlan,replacePlaceholders} from '../lib/server/gradio-workflow.ts';
const target={url:new URL('https://example.com'),hostname:'example.com',address:'93.184.216.34',family:4 as const};
test('pinned workflow preserves state between steps and isolates benchmark requests',async()=>{
 const bodies:any[]=[];
 const transport=async(t:any,opts:any)=>{
  assert.equal(t.address,target.address);assert.equal(t.url.origin,target.url.origin);
  if(opts.method==='POST') {bodies.push(JSON.parse(opts.body));return {status:200,headers:{},text:'{"event_id":"event-1"}'};}
  return {status:200,headers:{},text:'event: complete\ndata: ["assistant output"]\n\n'};
 };
 const plan=parsePlan(JSON.stringify({steps:[{apiName:'prepare',inputs:['{{message}}']},{apiName:'answer',inputs:['{{step0}}']}]}),'chat','0');
 assert.deepEqual(await executeGradioPlan(target,plan,'fixture',transport),['assistant output','assistant output']);
 await executeGradioPlan(target,plan,'new fixture',transport);
 assert.equal(bodies[0].session_hash,bodies[1].session_hash);
 assert.notEqual(bodies[0].session_hash,bodies[2].session_hash);
 assert.deepEqual(bodies[1].data,['assistant output']);
});
test('invalid dependencies, early final steps and partial streams fail closed',async()=>{
 assert.throws(()=>replacePlaceholders('{{step1}}','prompt',['done']));
 assert.throws(()=>replacePlaceholders('{{step0.99}}','prompt',[['one']]));
 assert.throws(()=>parsePlan(JSON.stringify({steps:[{apiName:'prepare',inputs:['{{message}}']},{apiName:'answer',inputs:[]}],finalStep:0}),'chat','0'));
 const plan=parsePlan('["{{message}}"]','chat','0');
 await assert.rejects(executeGradioPlan(target,plan,'fixture',async(_t,opts)=>({status:200,headers:{},text:opts.method==='POST'?'{"event_id":"event-1"}':'event: generating\ndata: ["READY"]\n\n'})));
});
