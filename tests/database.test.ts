import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
async function database() {
 const db=new PGlite();
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 for (const name of ['001_initial_schema.sql','002_measurement_provenance.sql','003_execution_leases.sql','004_private_evidence_projections.sql','005_queue_admission.sql','006_public_views_security_invoker.sql','20261003122059_preserve_result_classification.sql']) {
  await db.exec(fs.readFileSync(`supabase/migrations/${name}`,'utf8').replace('create extension if not exists "pgcrypto";',''));
 }
 return db;
}
test('migrations enforce atomic claim, expiry fencing, uniqueness and complete result set',async()=>{
 const db=await database();
 try {
 const agent=(await db.query<{id:string}>("insert into agents(name,slug,endpoint_url) values('Fixture','fixture','https://example.com') returning id")).rows[0].id;
 const run=(await db.query<{id:string}>('insert into benchmark_runs(agent_id) values($1) returning id',[agent])).rows[0].id;
 const one='00000000-0000-0000-0000-000000000001',two='00000000-0000-0000-0000-000000000002';
 const manifest={suite_version:'2.0',scoring_policy_version:'fixture',tests:[{key:'test',category:'safety'}]};
 const claim=async(token:string)=>(await db.query('select benchrx_claim_run($1,$2,$3) as claim',[run,token,manifest])).rows[0] as {claim:unknown};
 assert.ok((await claim(one)).claim);
 assert.equal((await claim(two)).claim,null);
 await assert.rejects(db.query('select benchrx_save_result($1,$2,$3)',[run,two,{test_key:'test'}]));
 await assert.rejects(db.query('select benchrx_finish_run($1,$2,$3)',[run,one,{}]));
 await db.query('select benchrx_save_result($1,$2,$3)',[run,one,{test_key:'test',passed:true,score:100}]);
 await assert.rejects(db.query('select benchrx_save_result($1,$2,$3)',[run,one,{test_key:'test',passed:false,score:0}]));
 await db.query("update benchmark_runs set lease_expires_at=now()-interval '1 second' where id=$1",[run]);
 assert.ok((await claim(two)).claim);
 assert.equal((await db.query<{ok:boolean}>('select benchrx_renew_lease($1,$2) as ok',[run,one])).rows[0].ok,false);
 await assert.rejects(db.query('select benchrx_finish_run($1,$2,$3)',[run,one,{}]));
 await db.query('select benchrx_finish_run($1,$2,$3)',[run,two,{production_score:100}]);
 assert.equal((await claim(one)).claim,null);
 await db.exec('set role anon');
 await assert.rejects(db.query('select benchrx_claim_run($1,$2,$3)',[run,one,manifest]));
 } finally {await db.close();}
});

test('invoker publication views preserve private data and public/completed filters',async()=>{
 const db=await database();
 const views=['public_agents','public_benchmark_runs','public_benchmark_results'];
 try {
 const publicAgent=(await db.query<{id:string}>("insert into agents(name,slug,endpoint_url) values('Fixture','public-fixture','https://example.com?token=TOP_SECRET') returning id")).rows[0].id;
 const privateAgent=(await db.query<{id:string}>("insert into agents(name,slug,endpoint_url,is_public) values('PRIVATE_AGENT','private-fixture','https://example.com',false) returning id")).rows[0].id;
 for (const [agent,status] of [[publicAgent,'completed'],[publicAgent,'running'],[privateAgent,'completed']]) {
  const run=(await db.query<{id:string}>("insert into benchmark_runs(agent_id,status,connection_snapshot) values($1,$2,$3) returning id",[agent,status,{credential:'TOP_SECRET'}])).rows[0].id;
  await db.query("insert into benchmark_results(benchmark_run_id,raw_response,judge_reason,test_snapshot) values($1,$2,'TOP_SECRET',$3)",[run,{response:'TOP_SECRET',authorization:'Bearer TOP_SECRET'},{key:'fixture',title:'Public test title',category:'safety',message:'TOP_SECRET'}]);
 }
 const options=await db.query<{reloptions:string[]}>("select reloptions from pg_class where relnamespace='public'::regnamespace and relname=any($1)",[views]);
 assert.equal(options.rows.length,3);
 for(const row of options.rows){assert.ok(row.reloptions.includes('security_invoker=true'));assert.ok(row.reloptions.includes('security_barrier=true'));}
 for(const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`);
  for(const table of ['agents','benchmark_runs','benchmark_results','test_cases','benchmark_shadow_judgments',...views]) await assert.rejects(db.query(`select * from ${table}`));
  await assert.rejects(db.query('select endpoint_url from agents'));
  await assert.rejects(db.query('select raw_response,test_snapshot from benchmark_results'));
  await assert.rejects(db.query("update public_agents set name='changed'"));
  await db.exec('reset role');
 }
 // Even if view access is accidentally re-granted, invoker semantics cannot
 // borrow the owner's private-table privileges (unlike a definer view).
 await db.exec('grant select on public_agents,public_benchmark_runs,public_benchmark_results to anon; set role anon');
 for(const view of views) await assert.rejects(db.query(`select * from ${view}`));
 await db.exec('reset role; set role service_role');
 for(const view of views) {
  const rows=(await db.query(`select * from ${view}`)).rows;
  assert.equal(rows.length,1,view);
  assert.equal(JSON.stringify(rows).includes('TOP_SECRET'),false);
  assert.equal(JSON.stringify(rows).includes('PRIVATE_AGENT'),false);
 }
 await assert.rejects(db.query('select endpoint_url from public_agents'));
 } finally {await db.close();}
});

test('queue admission rejects duplicate active work and enforces capacity',async()=>{
 const db=await database();
 try {
  const ids:string[]=[];
  for(let i=0;i<11;i++)ids.push((await db.query<{id:string}>("insert into agents(name,slug,endpoint_url) values('Fixture',$1,'https://example.com') returning id",['queue-'+i])).rows[0].id);
  await db.query('select benchrx_enqueue_run($1)',[ids[0]]);
  await assert.rejects(db.query('select benchrx_enqueue_run($1)',[ids[0]]));
  for(const id of ids.slice(1,10))await db.query('select benchrx_enqueue_run($1)',[id]);
  await assert.rejects(db.query('select benchrx_enqueue_run($1)',[ids[10]]));
  await db.exec("update benchmark_runs set status='failed'");
  await assert.rejects(db.query('select benchrx_enqueue_run($1)',[ids[0]]));
  await db.exec('set role anon');
  await assert.rejects(db.query('select benchrx_enqueue_run($1)',[ids[10]]));
 }finally{await db.close();}
});

test('publication preserves verdict states, evaluator provenance and historical rows',async()=>{
 const db=await database();
 try {
  const agent=(await db.query<{id:string}>("insert into agents(name,slug,endpoint_url) values('Fixture','states','https://example.com') returning id")).rows[0].id;
  const run=(await db.query<{id:string}>("insert into benchmark_runs(agent_id,status,production_score,suite_manifest) values($1,'completed',94.69,$2) returning id",[agent,{evaluator_version:'deterministic-v2.25'}])).rows[0].id;
  const fixtures=[
   {key:'pass',passed:true,score:100,observed:true,outcome_type:'agent_pass'},
   {key:'fail',passed:false,score:0,observed:true,outcome_type:'agent_fail'},
   {key:'inconclusive',passed:null,score:null,observed:true,outcome_type:'inconclusive'},
   {key:'unobserved',passed:null,score:null,observed:false,outcome_type:'unobserved'},
   {key:'not-applicable',passed:null,score:null,observed:false,outcome_type:'connector_diagnostic'},
  ];
  for (const r of fixtures) await db.query('insert into benchmark_results(benchmark_run_id,test_key,passed,score,observed,outcome_type,test_snapshot,execution_metadata,raw_response) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[run,r.key,r.passed,r.score,r.observed,r.outcome_type,{key:r.key,category:r.outcome_type==='connector_diagnostic'?'error_handling':'safety',message:'PRIVATE_PROMPT'},r.key==='not-applicable'?{diagnostic:{applicable:false,reason_code:'PRIVATE_DETAIL'}}:{},{response:'PRIVATE_RESPONSE'}]);
  const beforeRuns=await db.query('select * from benchmark_runs');
  const beforeResults=await db.query('select * from benchmark_results');
  await db.exec(fs.readFileSync('supabase/migrations/20261003122059_preserve_result_classification.sql','utf8'));
  assert.deepEqual(await db.query('select * from benchmark_runs'),beforeRuns);
  assert.deepEqual(await db.query('select * from benchmark_results'),beforeResults);
  await db.exec('set role service_role');
  assert.equal((await db.query<{evaluator_version:string}>('select evaluator_version from public_benchmark_runs where id=$1',[run])).rows[0].evaluator_version,'deterministic-v2.25');
  const rows=(await db.query<{passed:boolean|null;score:number|null;raw_response:Record<string,unknown>;test_cases:{key:string}}>('select * from public_benchmark_results where benchmark_run_id=$1',[run])).rows;
  const {resultState}=await import('../lib/measurement-view.ts');
  assert.deepEqual(Object.fromEntries(rows.map(r=>[r.test_cases.key,resultState(r)])),{pass:'PASS',fail:'FAIL',inconclusive:'INCONCLUSIVE',unobserved:'UNOBSERVED','not-applicable':'NOT APPLICABLE'});
  assert.equal(JSON.stringify(rows).includes('PRIVATE_'),false);
 } finally {await db.close();}
});
