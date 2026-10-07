import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration: escrow, last slot, retries, settlement, disputes and permissions',async()=>{
 const db=new PGlite();
 try {
 await db.exec(await readFile(new URL('../supabase/migrations/202610070001_subshare.sql',import.meta.url),'utf8'));
 await db.exec(`INSERT INTO subshare.users(id,first_name) VALUES(1,'Host'),(2,'Buyer'),(3,'Buyer 2');
 INSERT INTO subshare.subscriptions(id,host_id,service,slug,category,slots,available_slots,price,invite_type)
 VALUES('00000000-0000-4000-8000-000000000001',1,'Canva','canva','design',1,1,10001,'link');
 INSERT INTO subshare_private.subscription_access VALUES('00000000-0000-4000-8000-000000000001','https://example.com/secret','Private instructions');`);
 const first='00000000-0000-4000-8000-000000000011',second='00000000-0000-4000-8000-000000000012';
 for(const [id,buyer,invoice] of [[first,2,'invoice1'],[second,3,'invoice2']] as const)
 await db.query(`INSERT INTO subshare.orders(id,subscription_id,host_id,buyer_id,total_amount,provider,payment_invoice_id,idempotency_key)
 VALUES($1,'00000000-0000-4000-8000-000000000001',1,$2,10001,'yookassa',$3,$1)`,[id,buyer,invoice]);
 assert.equal((await db.query('SELECT * FROM subshare_private.read_order_access($1,2)',[first])).rows.length,0);
 await assert.rejects(()=>db.query('SELECT * FROM subshare_private.read_order_access($1,3)',[first]),/Forbidden/);
 const pay=async(id:string,invoice:string,event:string,amount=10001)=> (await db.query<{result:string}>(`SELECT subshare_private.activate_payment($1,'yookassa',$2,$3,$4,'RUB') result`,[id,invoice,event,amount])).rows[0]?.result;
 await assert.rejects(()=>pay(first,'invoice1','bad',10000),/Payment mismatch/);
 assert.equal(await pay(first,'invoice1','event1'),'escrow');
 assert.equal(await pay(first,'invoice1','event1'),'escrow');
 assert.equal(await pay(first,'invoice1','event1-new'),'escrow');
 assert.equal((await db.query<{invite_url:string}>('SELECT * FROM subshare_private.read_order_access($1,2)',[first])).rows[0]?.invite_url,'https://example.com/secret');
 assert.equal(await pay(second,'invoice2','event2'),'refund_pending');
 assert.equal((await db.query<{available_slots:number}>('SELECT available_slots FROM subshare.subscriptions')).rows[0]?.available_slots,0);
 assert.equal((await db.query('SELECT * FROM subshare_private.order_access')).rows.length,1);
 await assert.rejects(()=>db.query('SELECT subshare_private.confirm_order($1,3)',[first]),/Forbidden/);
 await assert.rejects(()=>db.query('SELECT subshare_private.confirm_order($1,2,true)',[first]),/cannot be confirmed/);
 await db.query('SELECT subshare_private.confirm_order($1,2)',[first]);
 await db.query('SELECT subshare_private.confirm_order($1,2)',[first]);
 assert.equal(Number((await db.query<{balance:number}>('SELECT balance FROM subshare.users WHERE id=1')).rows[0]?.balance),8501);
 assert.equal((await db.query('SELECT * FROM subshare_private.ledger')).rows.length,2);
 await assert.rejects(()=>db.query("SELECT subshare_private.open_dispute($1,2,'Broken invitation')",[first]),/window closed/);
 await db.exec(`INSERT INTO subshare.subscriptions(id,host_id,service,slug,category,slots,available_slots,price,invite_type)
 VALUES('00000000-0000-4000-8000-000000000002',1,'VPN','vpn','vpn',1,1,1000,'email');
 INSERT INTO subshare.orders(id,subscription_id,host_id,buyer_id,total_amount,provider,payment_invoice_id,idempotency_key)
 VALUES('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000002',1,2,10001,'yookassa','invoice3','00000000-0000-4000-8000-000000000013');`);
 const third='00000000-0000-4000-8000-000000000013';
 await pay(third,'invoice3','event3');
 await db.query("SELECT subshare_private.open_dispute($1,2,'Broken invitation')",[third]);
 await db.query("SELECT subshare_private.open_dispute($1,2,'Broken invitation')",[third]);
 assert.equal((await db.query('SELECT * FROM subshare.disputes')).rows.length,1);
 assert.equal((await db.query<{auto_confirm_deadline:null}>('SELECT auto_confirm_deadline FROM subshare.orders WHERE id=$1',[third])).rows[0]?.auto_confirm_deadline,null);
 await assert.rejects(()=>db.query('SELECT subshare_private.confirm_order($1,2,true)',[third]),/cannot be confirmed/);
 await db.exec('CREATE ROLE browser; SET ROLE browser;');
 await assert.rejects(()=>db.query('SELECT * FROM subshare_private.order_access'),/permission denied/);
 await assert.rejects(()=>db.query('SELECT * FROM subshare.orders'),/permission denied/);
 } finally {await db.close();}
});
