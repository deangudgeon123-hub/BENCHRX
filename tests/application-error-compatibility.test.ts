import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isApplicationErrorOutput} from '../lib/server/application-error-output.ts';
import {createGradioConnector} from '../lib/server/connectors/gradio.ts';
import {invokeConnector} from '../lib/server/connectors/interface.ts';
import {preflightConnection} from '../lib/server/connection-preflight.ts';
const matrix=JSON.parse(readFileSync(new URL('./fixtures/application-error-compatibility.json',import.meta.url),'utf8')) as {cases:{id:string;output:string;application_error:boolean}[]};
const target={url:new URL('https://fixture.hf.space'),hostname:'fixture.hf.space',address:'8.8.8.8',family:4 as const};
test('offline compatibility matrix links selected output, adapter reply and preflight',async()=>{
  process.env.BENCHRX_APP_ORIGIN='https://benchrx.fixture';process.env.BENCHRX_ADAPTER_SECRET='a'.repeat(32);
  for(const fixture of matrix.cases){
    assert.equal(isApplicationErrorOutput(fixture.output),fixture.application_error,fixture.id);
    const provider=createGradioConnector({pin:async()=>target,request:async(_target,options)=>({status:200,headers:{},text:options.method==='POST'?'{"event_id":"event"}':`event: complete\ndata: ${JSON.stringify([fixture.output])}\n\n`})});
    const reply=await invokeConnector(provider,new URLSearchParams({space:target.url.href,apiName:'chat',inputs:'["{{message}}"]'}),{message:'probe'});
    assert.equal(reply.status,fixture.application_error?502:200,fixture.id);
    assert.equal(reply.body.response,fixture.application_error?undefined:fixture.output);
    const preflight=await preflightConnection('https://benchrx.fixture/api/adapters/gradio',{
      pin:async url=>({...target,url:new URL(url)}),request:async()=>({status:reply.status,text:JSON.stringify(reply.body),headers:{}}),
    });
    assert.equal(preflight.ok,!fixture.application_error,fixture.id);
  }
});
