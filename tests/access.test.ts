import test from 'node:test';
import assert from 'node:assert/strict';
import {requireOperator,requireAdapter,readBoundedJson} from '../lib/server/access.ts';
test('operator and adapter authentication fail closed and remain separately scoped',()=>{
 process.env.BENCHRX_ADMIN_TOKEN='a'.repeat(32);process.env.BENCHRX_ADAPTER_SECRET='b'.repeat(32);
 const auth='Basic '+Buffer.from('benchrx:'+process.env.BENCHRX_ADMIN_TOKEN).toString('base64');
 assert.equal(requireOperator(new Request('https://benchrx.example/api',{headers:{Authorization:auth}})),null);
 assert.equal(requireOperator(new Request('https://benchrx.example/api',{headers:{Authorization:auth,Origin:'https://evil.example'}}))?.status,403);
 assert.equal(requireOperator(new Request('https://benchrx.example/api'))?.status,401);
 assert.equal(requireAdapter(new Request('https://benchrx.example/api',{headers:{Authorization:auth}}))?.status,401);
 assert.equal(requireAdapter(new Request('https://benchrx.example/api',{headers:{Authorization:'Bearer '+'b'.repeat(32)}})),null);
 delete process.env.BENCHRX_ADMIN_TOKEN;delete process.env.BENCHRX_ADAPTER_SECRET;
 assert.equal(requireAdapter(new Request('https://benchrx.example/api'))?.status,401);
});
test('body bound is enforced while reading, without trusting Content-Length',async()=>{
 await assert.rejects(readBoundedJson(new Request('https://example.com',{method:'POST',body:JSON.stringify({message:'x'.repeat(100)})}),32));
 assert.deepEqual(await readBoundedJson(new Request('https://example.com',{method:'POST',body:'{"message":"hi"}'})),{message:'hi'});
});
