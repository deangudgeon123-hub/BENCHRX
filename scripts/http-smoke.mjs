// Run after npm run build. Uses fixture credentials only; no live database access.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const token=randomBytes(32).toString('hex');
const origin='http://127.0.0.1:3187';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--port','3187','--hostname','127.0.0.1'],{
 env:{...process.env,BENCHRX_ADMIN_TOKEN:token,BENCHRX_ADAPTER_SECRET:randomBytes(32).toString('hex'),SUPABASE_SERVICE_ROLE_KEY:'',NEXT_PUBLIC_SUPABASE_URL:'',NEXT_TELEMETRY_DISABLED:'1'},stdio:'ignore'});
try {
 let ready=false;
 for(let i=0;i<100;i++){
  try{if((await fetch(origin)).ok){ready=true;break}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(ready,'Production server started');
 for(const path of ['/api/agents','/api/agents/fixture/rerun','/api/connections/test','/api/connections/discover','/api/adapters/generic','/api/adapters/gradio','/api/adapters/storkie']){
  const response=await fetch(origin+path,{method:'POST',body:'{"message":"fixture"}'});
  assert.equal(response.status,401,path);
 }
 for(const path of ['/admin','/admin/runs/00000000-0000-0000-0000-000000000001']){
  const response=await fetch(origin+path);assert.equal(response.status,404,path);
 }
 const challenge=await fetch(origin+'/operator');assert.equal(challenge.status,401);assert.match(challenge.headers.get('www-authenticate'),/^Basic /);
 const crossSite=await fetch(origin+'/api/agents',{method:'POST',headers:{Authorization:'Basic '+Buffer.from('benchrx:'+token).toString('base64'),Origin:'https://evil.example'}});
 assert.equal(crossSite.status,403);
 console.log('11 production HTTP access/CSRF checks passed');
}finally{child.kill('SIGTERM');}
