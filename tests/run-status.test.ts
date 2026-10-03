import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Run the real Next handlers/pages offline with fake database and transport only.
const root=new URL('../',import.meta.url);
const state={latest:{id:'failed-run',status:'failed'}, history:[] as Record<string,unknown>[], results:[] as Record<string,unknown>[], dbErrorTable:null as string|null,preflightOK:true,preflightEndpoints:[] as string[],insertCount:0,enqueueCount:0};
const query={
 from(table:string){return new Query(table);},
 async rpc(){state.enqueueCount++;return {data:{id:'queued-run',status:'queued'},error:null};},
};
class Query {
 readonly table:string;
 constructor(table:string){this.table=table;}
 insert(){state.insertCount++;return this;} delete(){return this;}
 select(){return this;} eq(){return this;} order(){return this;} limit(){return this;}
 single(){return this;} maybeSingle(){return this;}
 then(resolve:(value:unknown)=>unknown){return Promise.resolve({data:this.table==='public_agents'||this.table==='agents'?{id:'agent-id',name:'Fixture',slug:'fixture',category:'general',endpoint_url:'https://agent.fixture'}:this.table==='public_benchmark_runs'?state.history:this.table==='benchmark_runs'?state.latest:state.results,error:state.dbErrorTable===this.table?{message:'PRIVATE_DB_ERROR'}:null}).then(resolve);}
}
Object.assign(globalThis,{benchrxStage1DB:query,benchrxStage1React:React,benchrxStage1Preflight:async(endpoint:string)=>{state.preflightEndpoints.push(endpoint);return state.preflightOK?{ok:true}:{ok:false,status:502,diagnostics:{stage:'extraction',code:'missing_response'}};}});
registerHooks({
 resolve(specifier,context,next){
  if(specifier==='next/server')return next('next/server.js',context);
  if(specifier==='@/lib/server/connection-preflight')return {url:'benchrx-test:preflight',shortCircuit:true};
  if(specifier==='@/lib/server/pinned-https')return {url:'benchrx-test:pin',shortCircuit:true};
  if(specifier==='server-only')return {url:'benchrx-test:empty',shortCircuit:true};
  if(specifier==='@supabase/supabase-js')return {url:'benchrx-test:db',shortCircuit:true};
  if(specifier==='next/link')return {url:'benchrx-test:link',shortCircuit:true};
  if(specifier==='next/navigation')return {url:'benchrx-test:navigation',shortCircuit:true};
  if(specifier==='@/components/rerun-benchmark-button')return {url:'benchrx-test:rerun',shortCircuit:true};
  if(specifier==='@/components/site-header')return {url:'benchrx-test:header',shortCircuit:true};
  if(specifier.startsWith('@/')){
   const url=new URL(specifier.slice(2),root);
   const path=fileURLToPath(url);
   return next(fs.existsSync(path+'.tsx')?url.href+'.tsx':url.href+'.ts',context);
  }
  return next(specifier,context);
 },
 load(url,context,next){
  const sources:Record<string,string>={
   'benchrx-test:preflight':'export const preflightConnection=globalThis.benchrxStage1Preflight;',
   'benchrx-test:pin':'export async function validateAndPinPublicHttpsUrl(url){return {url:new URL(url),addresses:[]};}',
   'benchrx-test:empty':'export {};',
   'benchrx-test:db':'export function createClient(){return globalThis.benchrxStage1DB;}',
   'benchrx-test:link':'export default "a";',
   'benchrx-test:navigation':'export function notFound(){throw new Error("not found");} export function useRouter(){return {refresh(){}};}',
   'benchrx-test:rerun':'export function RerunBenchmarkButton(p){return globalThis.benchrxStage1React.createElement("button",{"data-completed-run":p.latestCompletedRunId,"data-latest-status":p.latestRun?.status},"Rerun");}',
   'benchrx-test:header':'export function SiteHeader(){return null;}',
  };
  if(url in sources)return {format:'module',source:sources[url],shortCircuit:true};
  if(url.startsWith(root.href)&&/\.tsx?$/.test(url))return {format:'module',source:ts.transpileModule(fs.readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
  return next(url,context);
 }
});
process.env.NEXT_PUBLIC_SUPABASE_URL='https://database.fixture';
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';
process.env.BENCHRX_APP_ORIGIN='https://benchrx.fixture';
process.env.BENCHMARK_API_URL='https://worker.fixture';
process.env.BENCHMARK_API_SECRET='x'.repeat(32);
const page=(await import('../app/agents/[slug]/page.tsx')).default;
const {POST}=await import('../app/api/agents/[slug]/rerun/route.ts');
const render=async()=>renderToStaticMarkup(await page({params:Promise.resolve({slug:'fixture'})}));

test('failed worker execution never renders an indefinitely running agent benchmark',async()=>{
 state.history=[];state.latest={id:'failed-run',status:'failed'};
 const html=await render();
 assert.match(html,/BENCHRX execution failed/);
 assert.doesNotMatch(html,/We’re testing this agent now/);
});
test('scorecard gives rerun polling both the completion id and latest failure status',async()=>{
 state.history=[{id:'completed-run',status:'completed',production_score:100,scoring_policy_version:'behavioural-v2.2',suite_version:'2.0',evaluator_version:'deterministic-v2.25',readiness_status:'meets_benchmark_gates',created_at:'2026-10-03',completed_at:'2026-10-03'}];
 const html=await render();
 assert.match(html,/data-completed-run="completed-run"/);
 assert.match(html,/data-latest-status="failed"/);
 assert.match(html,/BENCHRX execution failed/);
});
test('database errors cannot masquerade as pending runs or empty evidence',async()=>{
 for(const table of ['public_agents','benchmark_runs','public_benchmark_runs','public_benchmark_results']){
  state.dbErrorTable=table;
  try{await assert.rejects(render(),/Unable to load/);}finally{state.dbErrorTable=null;}
 }
});
test('persisted rerun stays accepted when the HTTP trigger fails',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('PRIVATE_TRANSPORT_ERROR');});
 const response=await POST(new Request('https://benchrx.fixture/api/agents/fixture/rerun',{method:'POST',headers:{origin:'https://benchrx.fixture'}}),{params:Promise.resolve({slug:'fixture'})});
 assert.equal(response.status,201);
 assert.deepEqual(await response.json(),{benchmarkRun:{id:'queued-run',status:'queued'},benchmarkTriggered:false});
});


test('submission and rerun refuse failed preflight before any agent insert or queue admission',async()=>{
 const {POST:submit}=await import('../app/api/agents/route.ts');
 const {POST:connectionTest}=await import('../app/api/connections/test/route.ts');
 state.preflightOK=false;state.insertCount=0;state.enqueueCount=0;
 try {
  const request=(body:unknown)=>new Request('https://benchrx.fixture/api/agents',{method:'POST',headers:{'Content-Type':'application/json',origin:'https://benchrx.fixture'},body:JSON.stringify(body)});
  const submitted=await submit(request({connectionType:'native',name:'Fixture',endpointUrl:'https://agent.fixture'}));
  assert.equal(submitted.status,502);
  assert.equal(state.insertCount,0);assert.equal(state.enqueueCount,0);
  const rerun=await POST(request({}),{params:Promise.resolve({slug:'fixture'})});
  assert.equal(rerun.status,502);assert.equal(state.enqueueCount,0);
  const native=await connectionTest(request({connectionType:'native',endpointUrl:'https://native.fixture'}));
  assert.equal(native.status,502);
  assert.equal(state.preflightEndpoints.at(-1),'https://native.fixture/');
 } finally {state.preflightOK=true;}
});
