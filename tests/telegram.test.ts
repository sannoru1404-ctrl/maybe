import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateTelegramInitData, TelegramAuthError, authenticateTelegramRequest } from '../src/server/auth/telegram.js';
const token = '123456:test-only-token';
const now = 1_800_000_000;
function signed(fields: Record<string,string> = {}) {
 const p = new URLSearchParams({ auth_date: String(now), user: JSON.stringify({id:12345,first_name:'Иван + &'}), ...fields });
 const data = [...p].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
 p.set('hash',createHmac('sha256',createHmac('sha256','WebAppData').update(token).digest()).update(data).digest('hex'));
 return p.toString();
}
test('accepts signed Unicode user, preserves signature field and string ID',()=>{
 const session=validateTelegramInitData(signed({signature:'telegram-ed25519-signature'}),token,{nowSeconds:now});
 assert.equal(session.telegramId,'12345'); assert.equal(session.user.first_name,'Иван + &');
});
test('rejects tampering and wrong bot token',()=>{
 assert.throws(()=>validateTelegramInitData(signed().replace('1800000000','1800000001'),token,{nowSeconds:now}),TelegramAuthError);
 assert.throws(()=>validateTelegramInitData(signed(),'wrong',{nowSeconds:now}),TelegramAuthError);
});
test('rejects old and future signed payloads',()=>{
 for(const date of [now-3601,now+31]) assert.throws(()=>validateTelegramInitData(signed({auth_date:String(date)}),token,{nowSeconds:now}),TelegramAuthError);
 assert.doesNotThrow(()=>validateTelegramInitData(signed({auth_date:String(now-3600)}),token,{nowSeconds:now}));
});
test('rejects duplicates, malformed hash, malformed percent encoding and oversize input',()=>{
 for(const raw of [signed()+'&user=x', signed().replace(/hash=[^&]+/,'hash=xyz'),signed()+'&x=%zz','x'.repeat(16385),''])
 assert.throws(()=>validateTelegramInitData(raw,token,{nowSeconds:now}),TelegramAuthError);
});
test('rejects invalid signed user and missing required fields',()=>{
 for(const fields of [{user:'{}'},{user:'null'},{user:'{'},{user:JSON.stringify({id:1.5,first_name:'A'})},{auth_date:'no'}])
 assert.throws(()=>validateTelegramInitData(signed(fields),token,{nowSeconds:now}),TelegramAuthError);
});
test('request adapter rejects missing authorization and accepts fresh initData',()=>{
 assert.throws(()=>authenticateTelegramRequest({headers:new Headers()},token),TelegramAuthError);
 const raw=signed({auth_date:String(Math.floor(Date.now()/1000))});
 assert.equal(authenticateTelegramRequest({headers:new Headers({authorization:`tma ${raw}`})},token).telegramId,'12345');
});
