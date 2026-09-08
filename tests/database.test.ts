import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
async function database() {
 const db=new PGlite();
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 for (const name of ['001_initial_schema.sql','002_measurement_provenance.sql','003_execution_leases.sql','004_private_evidence_projections.sql']) {
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

test('anonymous reads cannot obtain raw evidence or endpoint configuration',async()=>{
 const db=await database();
 try {
 const a=(await db.query<{id:string}>("insert into agents(name,slug,endpoint_url) values('Fixture','public-fixture','https://example.com?token=TOP_SECRET') returning id")).rows[0].id;
 const r=(await db.query<{id:string}>("insert into benchmark_runs(agent_id,status) values($1,'completed') returning id",[a])).rows[0].id;
 await db.query("insert into benchmark_results(benchmark_run_id,raw_response,judge_reason) values($1,$2,'TOP_SECRET')",[r,{response:'TOP_SECRET',authorization:'Bearer TOP_SECRET'}]);
 await db.exec('set role anon');
 for(const table of ['agents','benchmark_runs','benchmark_results','test_cases','benchmark_shadow_judgments']) await assert.rejects(db.query(`select * from ${table}`));
 for(const view of ['public_agents','public_benchmark_runs','public_benchmark_results']) assert.equal(JSON.stringify((await db.query(`select * from ${view}`)).rows).includes('TOP_SECRET'),false);
 await assert.rejects(db.query('select endpoint_url from public_agents'));
 await assert.rejects(db.query("update public_agents set name='changed'"));
 } finally {await db.close();}
});
