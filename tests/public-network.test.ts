import test from 'node:test';
import assert from 'node:assert/strict';
import {isPublicIp,validateAndPinPublicHttpsUrl} from '../lib/server/pinned-https.ts';
test('rejects private, mapped, reserved and tunneled addresses',()=>{
 for(const ip of ['127.0.0.1','10.1.1.1','169.254.169.254','100.64.0.1','192.0.2.1','::1','::ffff:7f00:1','::ffff:169.254.169.254','2002:7f00:1::','fc00::1','224.0.0.1']) assert.equal(isPublicIp(ip),false,ip);
 assert.equal(isPublicIp('93.184.216.34'),true);
});
test('rejects unsupported schemes, ports and URL credentials before DNS',async()=>{
 for(const url of ['http://example.com','https://example.com:8080','https://u:secret@example.com','https://[::1]','https://127.1']) await assert.rejects(validateAndPinPublicHttpsUrl(url,{invalidUrlMessage:'invalid',httpsRequiredMessage:'https'}));
});
