import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const available=existsSync('.test-build/config-validation.js');
let validatePublicConfig;
if(available)({validatePublicConfig}=await import('../.test-build/config-validation.js'));
test('public configuration validator exists',()=>assert.ok(available,'Config validator is missing'));
const unit=(name,fn)=>test(name,{skip:!available},fn);
unit('missing config is reported without a credential fallback',()=>assert.match(validatePublicConfig({}),/belum dikonfigurasi/));
unit('frontend rejects service-role JWTs',()=>{
  const payload=Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url');
  assert.match(validatePublicConfig({url:'https://unit.invalid',key:`header.${payload}.test`}),/service-role/);
});
unit('frontend rejects secret keys and credential-bearing URLs',()=>{
  assert.match(validatePublicConfig({url:'https://unit.invalid',key:'sb_secret_not_a_real_key'}),/Secret key/);
  assert.match(validatePublicConfig({url:'https://user:password@unit.invalid',key:'sb_publishable_not_a_real_key'}),/credential/);
});
unit('plain HTTP is permitted only for a local Supabase instance',()=>{
  assert.match(validatePublicConfig({url:'http://unit.invalid',key:'sb_publishable_not_a_real_key'}),/HTTPS/);
  assert.equal(validatePublicConfig({url:'http://127.0.0.1:54321',key:'sb_publishable_not_a_real_key'}),'');
});
unit('public keys are configuration values, not proof of authentication',()=>{
  const payload=Buffer.from(JSON.stringify({role:'anon'})).toString('base64url');
  assert.equal(validatePublicConfig({url:'https://unit.invalid',key:`header.${payload}.test`}),'');
});
