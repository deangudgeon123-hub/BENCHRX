import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePath,setPath,deletePath,getPath} from '../lib/server/json-path.ts';
test('rejects prototype traversal and oversized paths at parser and setter',()=>{
 for (const p of ['__proto__.polluted','constructor.prototype.polluted','a.__proto__.b','messages[999999999].content']) assert.throws(()=>parsePath(p,'request'));
 assert.throws(()=>setPath({},['__proto__','polluted'],'yes'));
 assert.throws(()=>deletePath({},['__proto__','polluted']));
 assert.equal(({} as Record<string,unknown>).polluted,undefined);
 assert.equal(getPath({},['constructor']),undefined);
});
test('normal nested request mappings preserve fixed fields without mutating input',()=>{
 const initial={model:'fixture',messages:[{role:'user',content:'old'}]};
 const body=setPath(initial,parsePath('messages[0].content','request'),'new');
 assert.equal(getPath(body,['messages',0,'content']),'new');
 assert.equal(initial.messages[0].content,'old');
 assert.equal(body.model,'fixture');
});
