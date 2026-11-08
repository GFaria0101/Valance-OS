import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sessionId=(user,device=0)=>id(10000+user*100+device);
async function asUser(user,sql,params=[],session=sessionId(user)){
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
 [id(user),JSON.stringify({sub:id(user),role:'authenticated',session_id:session})]);
 await db.exec('set role authenticated');return db.query(sql,params);
}
async function owner(sql,params=[]){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)");return db.query(sql,params);}
const startSession=(user,device=0)=>asUser(user,'select touch_app_session(false)',[],sessionId(user,device));
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid(),auth.jwt() to authenticated,anon,service_role;`);
 const migrations=new URL('../supabase/migrations/',import.meta.url);
 const migrationNames=(await readdir(migrations)).filter(name=>name.endsWith('.sql')).sort();
 for(const migration of migrationNames.filter(name=>name<'202611070003_staff_roles.sql')){
 await db.exec(await readFile(new URL(migration,migrations),'utf8'));}
 for(const n of [1,2,3,4,5,6,7,8,9,19])await owner('insert into auth.users values($1,$2)',[id(n),`user${n}@example.test`]);
 await owner('insert into organizations(id,name) values($1,$2),($3,$4)',[id(100),'Company A',id(101),'Company B']);
 await owner('insert into stores(id,organization_id,name) values($1,$2,$3),($4,$2,$5),($6,$7,$8)',[id(110),id(100),'Quiosque 1',id(111),'Quiosque 2',id(112),id(101),'Foreign store']);
 for(const [n,org,store,role,active] of [[1,100,null,'admin',true],[2,100,110,'manager',true],[3,100,110,'seller',true],[4,100,110,'seller',true],[5,100,111,'seller',true],[6,101,null,'admin',true],[7,101,112,'seller',true],[8,100,110,'seller',false],[9,100,111,'manager',true]]){
 await owner('insert into profiles(id,organization_id,store_id,role,name,email,external_id,is_active) values($1,$2,$3,$4,$5,$6,$7,$8)',[id(n),id(org),store?id(store):null,role,`User ${n}`,`user${n}@example.test`,`seller-${n}`,active]);}
 for(const [n,org] of [[120,100],[121,100],[122,101]])await owner('insert into agendas(id,organization_id,name) values($1,$2,$3)',[id(n),id(org),`Agenda ${n}`]);
 for(const [n,org,store,seller] of [[130,100,110,3],[131,100,110,4],[132,100,111,5],[133,101,112,7]])await owner('insert into customers(id,organization_id,store_id,external_id,name,phone,responsible_id) values($1,$2,$3,$4,$5,$6,$7)',[id(n),id(org),id(store),`customer-${n}`,`Customer ${n}`,'5511999998888',id(seller)]);
 for(const [n,store,customer,seller] of [[140,110,130,null],[141,110,130,3],[142,110,131,4],[143,111,132,5]])await owner("insert into contact_tasks(id,organization_id,store_id,agenda_id,customer_id,assigned_to,due_date) values($1,$2,$3,$4,$5,$6,$7)",[id(n),id(100),id(store),id(120),id(customer),seller?id(seller):null,n===141?'2026-10-24':'2026-10-25']);
 for(const [n,agenda,when,completedBy] of [[144,120,'2026-10-01T10:00:00Z',3],[145,121,'2026-10-08T10:00:00Z',4]])await owner("insert into contact_tasks(id,organization_id,store_id,agenda_id,customer_id,assigned_to,due_date,status,outcome,completed_by,completed_at) values($1,$2,$3,$4,$5,$6,$7,'completed','contacted',$6,$8)",[id(n),id(100),id(110),id(agenda),id(130),id(completedBy),when.slice(0,10),when]);
 await owner("insert into contact_tasks(id,organization_id,store_id,agenda_id,customer_id,assigned_to,due_date,status,outcome,completed_by,completed_at) values($1,$2,$3,$4,$5,$6,'2026-10-09','completed','no_response',$6,'2026-10-09T10:00:00Z')",[id(146),id(100),id(110),id(120),id(131),id(4)]);
 for(const [n,org,store,customer,seller,value] of [[150,100,110,130,3,100],[151,100,110,131,4,200],[152,100,111,132,5,300],[153,101,112,133,7,400]])await owner("insert into sales(id,organization_id,store_id,external_id,customer_id,seller_id,sold_at,gross_amount,discount_amount) values($1,$2,$3,$4,$5,$6,'2026-10-10T12:00:00Z',$7,10)",[id(n),id(org),id(store),`sale-${n}`,id(customer),id(seller),value]);
 // Exercise the role migration against existing store-bound history, as in production.
 for(const migration of migrationNames.filter(name=>name>='202611070003_staff_roles.sql')){
 await db.exec(await readFile(new URL(migration,migrations),'utf8'));}
 // Start each signed-in fixture once. Queries never bootstrap or revive a session.
 for(const n of [1,2,3,4,5,6,7,9])await startSession(n);
});
after(async()=>{await db?.close();});

test('database migration enforces organization/store/seller read isolation and anonymous denial',async()=>{
 assert.equal((await asUser(1,'select * from stores')).rows.length,2);
 assert.equal((await asUser(2,'select * from stores')).rows.length,1);
 assert.equal((await asUser(3,'select * from sales')).rows.length,1);
 assert.equal((await asUser(2,'select * from sales')).rows.length,2);
 assert.equal((await asUser(6,'select * from sales')).rows.length,1);
 assert.equal((await asUser(3,'select * from profiles')).rows.length,1);
 assert.equal((await asUser(3,'select * from customers')).rows.length,1);
 await db.exec('reset role;set role anon');await assert.rejects(()=>db.query('select * from profiles'),/permission denied/);
 await assert.rejects(()=>asUser(2,'select report_snapshot($1,$2,$3)',[id(111),'2026-10-01','2026-10-31']),/não autorizado/);
});

test('clients cannot mutate raw tables or elevate roles; checked mutations stay within scope',async()=>{
 await assert.rejects(()=>asUser(3,"update profiles set role='admin' where id=$1",[id(3)]),/permission denied/);
 await assert.rejects(()=>asUser(3,"insert into sales(organization_id,store_id,external_id,sold_at,gross_amount) values($1,$2,'forged',now(),1)",[id(100),id(110)]),/permission denied/);
 await assert.rejects(()=>asUser(2,'select set_profile_access($1,false)',[id(5)]),/Sem permissão/);
 await assert.rejects(()=>asUser(2,'select set_profile_access($1,false)',[id(1)]),/Sem permissão/);
 await assert.rejects(()=>asUser(1,'select set_profile_access($1,false)',[id(1)]),error=>error.detail==='LAST_ACTIVE_ADMIN');
 await asUser(3,"select save_own_profile('Seller Updated','seller-handle')");
 assert.equal((await owner('select role from profiles where id=$1',[id(3)])).rows[0].role,'seller');
 await assert.rejects(()=>asUser(3,'select save_target($1,$2,$3,$4)',[id(110),id(3),'2026-10-01',1000]),/Sem permissão/);
 await asUser(2,'select save_target($1,$2,$3,$4)',[id(110),id(3),'2026-10-01',1000]);
 await asUser(2,'select save_target($1,$2,$3,$4)',[id(110),id(3),'2026-10-01',1500]);
 assert.equal((await owner('select count(*) as n from sales_targets')).rows[0].n,1);
});

test('distribution is atomic, rejects cross-store/inactive sellers and duplicate allocation',async()=>{
 await assert.rejects(()=>asUser(3,"select complete_contact($1,'contacted')",[id(140)]),/indisponível/);
 await assert.rejects(()=>asUser(2,'select assign_contacts($1,$2,1,$3)',[id(110),id(120),[id(5)]]),/mesmo quiosque/);
 await assert.rejects(()=>asUser(2,'select assign_contacts($1,$2,1,$3)',[id(110),id(120),[id(8)]]),/mesmo quiosque/);
 await assert.rejects(()=>asUser(2,'select assign_contacts($1,$2,5,$3)',[id(110),id(120),[id(3)]]),/suficientes/);
 assert.equal((await owner('select assigned_to from contact_tasks where id=$1',[id(140)])).rows[0].assigned_to,null);
 const result=await asUser(2,'select assign_contacts($1,$2,1,$3) as data',[id(110),id(120),[id(3)]]);
 assert.equal(result.rows[0].data.assigned,1);
 await assert.rejects(()=>asUser(2,'select assign_contacts($1,$2,1,$3)',[id(110),id(120),[id(3)]]),/suficientes/);
 await assert.rejects(()=>asUser(4,"select complete_contact($1,'contacted')",[id(140)]),/indisponível/);
 await asUser(3,"select complete_contact($1,'contacted')",[id(140)]);
 const first=(await owner('select completed_at from contact_tasks where id=$1',[id(140)])).rows[0].completed_at;
 await asUser(3,"select complete_contact($1,'contacted')",[id(140)]);
 assert.equal((await owner('select completed_at from contact_tasks where id=$1',[id(140)])).rows[0].completed_at.toISOString(),first.toISOString());
});

test('reports aggregate real authorized rows, count gross before discounts and attribute sale once to latest 15-day contact',async()=>{
 const data=(await asUser(2,'select report_snapshot($1,$2,$3) as data',[id(110),'2026-10-01','2026-10-31'])).rows[0].data;
 assert.equal(data.totals.gross,300);assert.equal(data.totals.orders,2);assert.equal(data.totals.attributed_gross,100);
 assert.equal(data.by_agenda.find(a=>a.agenda_id===id(120)).gross,0);
 assert.equal(data.by_agenda.find(a=>a.agenda_id===id(121)).gross,100);
 assert.equal(data.by_seller.find(s=>s.seller_id===id(3)).gross,100);
 assert.equal(data.by_seller.find(s=>s.seller_id===id(4)).gross,200);
 assert.equal(data.totals.customers_contacted,1);assert.equal(data.totals.converted_customers,1);
 assert.equal(data.totals.conversion,100);
 const seller=(await asUser(3,'select report_snapshot($1,$2,$3) as data',[id(110),'2026-10-01','2026-10-31'])).rows[0].data;
 assert.equal(seller.totals.gross,100);assert.equal(seller.profiles.length,1);
});

test('normalized import is idempotent, updates ownership and cancellations, and rolls back invalid batches',async()=>{
 const payload={customers:[{external_id:'import-customer',name:'Imported',phone:'5511999998888',birth_date:'1990-05-20'}],sales:[{external_id:'import-sale',customer_external_id:'import-customer',seller_external_id:'seller-3',sold_at:'2026-10-20T12:00:00Z',gross_amount:500,discount_amount:50}]};
 await asUser(2,'select import_presence_batch($1,$2)',[id(110),JSON.stringify(payload)]);
 await asUser(2,'select import_presence_batch($1,$2)',[id(110),JSON.stringify(payload)]);
 assert.equal((await owner("select count(*) as n from sales where external_id='import-sale'")).rows[0].n,1);
 assert.equal((await owner("select responsible_id from customers where external_id='import-customer'")).rows[0].responsible_id,id(3));
 const invalid={customers:[{external_id:'rolled-back',name:'Must disappear'}],sales:[{...payload.sales[0],external_id:'invalid-sale',seller_external_id:'seller-5'}]};
 await assert.rejects(()=>asUser(2,'select import_presence_batch($1,$2)',[id(110),JSON.stringify(invalid)]),/vendedor/);
 assert.equal((await owner("select count(*) as n from customers where external_id='rolled-back'")).rows[0].n,0);
 const excessiveDiscount={customers:[{external_id:'money-rollback',name:'Rolled back'}],sales:[{external_id:'bad-discount',customer_external_id:'money-rollback',seller_external_id:'seller-3',sold_at:'2026-10-20T12:00:00Z',gross_amount:100,discount_amount:101}]};
 await assert.rejects(()=>asUser(2,'select import_presence_batch($1,$2)',[id(110),JSON.stringify(excessiveDiscount)]),/check constraint/);
 assert.equal((await owner("select count(*) as n from customers where external_id='money-rollback'")).rows[0].n,0);
 await asUser(2,'select import_presence_batch($1,$2)',[id(110),JSON.stringify({customers:[{external_id:'import-customer',name:'Renamed'}]})]);
 const sparse=(await owner("select phone,birth_date from customers where external_id='import-customer'")).rows[0];
 assert.equal(sparse.phone,'5511999998888');assert.equal(sparse.birth_date.toISOString().slice(0,10),'1990-05-20');
 await asUser(2,'select import_presence_batch($1,$2)',[id(110),JSON.stringify({customers:[{external_id:'import-customer',name:'Renamed',phone:null,birth_date:null}]})]);
 const cleared=(await owner("select phone,birth_date from customers where external_id='import-customer'")).rows[0];assert.equal(cleared.phone,null);assert.equal(cleared.birth_date,null);
 await asUser(2,'select import_presence_batch($1,$2)',[id(110),JSON.stringify({sales:[{external_id:'import-sale',sold_at:'2026-10-20T12:00:00Z',gross_amount:500,returned_amount:100}]})]);
 await asUser(2,'select import_presence_batch($1,$2)',[id(110),JSON.stringify({sales:[{external_id:'import-sale',sold_at:'2026-10-20T12:00:00Z',gross_amount:500}]})]);
 const saleSparse=(await owner("select seller_id,customer_id,discount_amount,returned_amount from sales where external_id='import-sale'")).rows[0];
 assert.equal(saleSparse.seller_id,id(3));assert(saleSparse.customer_id);assert.equal(Number(saleSparse.discount_amount),50);assert.equal(Number(saleSparse.returned_amount),100);
 payload.sales[0].status='cancelled';await asUser(2,'select import_presence_batch($1,$2)',[id(110),JSON.stringify(payload)]);
 assert.equal((await owner("select responsible_id from customers where external_id='import-customer'")).rows[0].responsible_id,null);
 await assert.rejects(()=>asUser(2,'select import_presence_batch($1,$2)',[id(111),'{}']),/Sem permissão/);
});

test('provisioning rechecks active caller, roles and store, then disabling denies even existing JWT reads and RPCs',async()=>{
 await assert.rejects(()=>asUser(2,'select provision_staff($1,$2,$3,$4,$5)',[id(19),id(111),'seller','Staff','user19@example.test']),/Sem permissão/);
 await assert.rejects(()=>asUser(2,'select provision_staff($1,$2,$3,$4,$5)',[id(19),id(110),'admin','Staff','user19@example.test']),/Sem permissão/);
 await assert.rejects(()=>asUser(2,'select provision_staff($1,$2,$3,$4,$5)',[id(19),id(110),'seller','Staff','wrong@example.test']),/autenticação não encontrado/);
 await asUser(2,'select provision_staff($1,$2,$3,$4,$5)',[id(19),id(110),'seller','Staff','user19@example.test']);
 await owner("insert into contact_tasks(id,organization_id,store_id,agenda_id,customer_id,assigned_to,due_date) values($1,$2,$3,$4,$5,$6,'2099-01-01')",[id(173),id(100),id(110),id(121),id(131),id(19)]);
 await owner("insert into contact_tasks(id,organization_id,store_id,agenda_id,customer_id,assigned_to,due_date,status,outcome,completed_by,completed_at) values($1,$2,$3,$4,$5,$6,'2098-01-01','completed','no_response',$6,now())",[id(174),id(100),id(110),id(121),id(131),id(19)]);
 await asUser(2,'select set_profile_access($1,false)',[id(19)]);
 assert.equal((await owner('select assigned_to from contact_tasks where id=$1',[id(173)])).rows[0].assigned_to,null);
 assert.equal((await owner('select assigned_to from contact_tasks where id=$1',[id(174)])).rows[0].assigned_to,id(19));
 await asUser(2,'select assign_contacts($1,$2,1,$3)',[id(110),id(121),[id(3)]]);
 assert.equal((await owner('select assigned_to from contact_tasks where id=$1',[id(173)])).rows[0].assigned_to,id(3));
 assert.equal((await asUser(19,'select * from profiles')).rows.length,0);
 assert.equal((await asUser(19,'select * from sales')).rows.length,0);
 await assert.rejects(()=>asUser(19,"select save_own_profile('Unauthorized','x')"),/sem acesso ativo/);
 await assert.rejects(()=>asUser(19,'select report_snapshot($1,$2,$3)',[id(110),'2026-10-01','2026-10-31']),/sem acesso ativo/);
});

test('agenda generation is idempotent, preserves existing pending tasks, and audit cannot be edited',async()=>{
 const first=(await asUser(2,'select generate_agenda_tasks($1,$2) as n',[id(110),id(120)])).rows[0].n;
 const second=(await asUser(2,'select generate_agenda_tasks($1,$2) as n',[id(110),id(120)])).rows[0].n;
 assert.equal(second,0);assert(first>=0);
 await assert.rejects(()=>asUser(3,'select generate_agenda_tasks($1,$2)',[id(110),id(120)]),/Sem permissão/);
 await assert.rejects(()=>asUser(2,"delete from audit_log"),/permission denied/);
 assert((await asUser(2,'select * from audit_log')).rows.length>0);
});

test('opt-out persists, blocks further contact and suppresses future agenda generation',async()=>{
 await owner('insert into customers(id,organization_id,store_id,external_id,name,phone,responsible_id) values($1,$2,$3,$4,$5,$6,$7)',[id(170),id(100),id(110),'optout-customer','Opt Out Customer','5511999998888',id(3)]);
 await owner("insert into contact_tasks(id,organization_id,store_id,agenda_id,customer_id,assigned_to,due_date) values($1,$2,$3,$4,$5,$6,current_date)",[id(171),id(100),id(110),id(120),id(170),id(3)]);
 await asUser(3,"select complete_contact($1,'opt_out')",[id(171)]);
 assert.equal((await owner('select do_not_contact from customers where id=$1',[id(170)])).rows[0].do_not_contact,true);
 await asUser(2,'select generate_agenda_tasks($1,$2)',[id(110),id(121)]);
 assert.equal((await owner('select count(*) as n from contact_tasks where customer_id=$1 and agenda_id=$2',[id(170),id(121)])).rows[0].n,0);
 await owner("insert into contact_tasks(id,organization_id,store_id,agenda_id,customer_id,assigned_to,due_date) values($1,$2,$3,$4,$5,$6,current_date)",[id(172),id(100),id(110),id(121),id(170),id(3)]);
 await assert.rejects(()=>asUser(3,"select complete_contact($1,'contacted')",[id(172)]),/não autoriza/);
});

test('seller assisted conversion counts another closing seller without exposing their sale rows or revenue',async()=>{
 const snapshot=(await asUser(4,'select report_snapshot($1,$2,$3) as data',[id(110),'2026-10-01','2026-10-20'])).rows[0].data;
 assert.equal(snapshot.totals.gross,200);assert.equal(snapshot.totals.attributed_gross,100);
 assert.equal(snapshot.totals.customers_contacted,1);assert.equal(snapshot.totals.converted_customers,1);assert.equal(snapshot.totals.conversion,100);
 assert.equal(snapshot.by_agenda.find(a=>a.agenda_id===id(121)).gross,100);
 assert.equal((await asUser(4,'select * from sales where id=$1',[id(150)])).rows.length,0);
 await assert.rejects(()=>asUser(4,'select private.seller_contact_metrics($1,$2,$3)',[id(111),'2026-10-01','2026-10-20']),/não autorizado/);
 await assert.rejects(()=>asUser(2,'select private.seller_contact_metrics($1,$2,$3)',[id(110),'2026-10-01','2026-10-20']),/não autorizado/);
});

test('optional report filters constrain revenue, prior period, tasks and attribution without weakening scope',async()=>{
 await owner("insert into sales(id,organization_id,store_id,external_id,customer_id,seller_id,sold_at,gross_amount) values($1,$2,$3,'prior-sale',$4,$5,'2025-10-11T12:00:00Z',120)",[id(180),id(100),id(110),id(130),id(3)]);
 const report=async(seller=null,agenda=null,minimum=0,user=2)=>(await asUser(user,'select report_snapshot($1,$2,$3,$4,$5,$6) as data',[id(110),'2026-10-01','2026-10-20',seller,agenda,minimum])).rows[0].data;
 const ownSeller=await report(id(3));assert.equal(ownSeller.totals.gross,100);assert.equal(ownSeller.totals.previous_gross,120);assert.equal(ownSeller.by_seller.length,1);
 const agenda=await report(null,id(121));assert.equal(agenda.totals.gross,100);assert.equal(agenda.by_agenda.length,1);assert.equal(agenda.by_agenda[0].gross,100);
 const minimum=await report(null,null,150);assert.equal(minimum.totals.gross,200);assert.equal(minimum.totals.previous_gross,0);
 const none=await report(id(4),id(121));assert.equal(none.totals.gross,0);
 const assisted=await report(null,id(121),50,4);assert.equal(assisted.totals.gross,0);assert.equal(assisted.totals.attributed_gross,100);assert.equal(assisted.totals.converted_customers,1);
 const assistedTooSmall=await report(null,id(121),150,4);assert.equal(assistedTooSmall.totals.attributed_gross,0);assert.equal(assistedTooSmall.totals.converted_customers,0);
 await assert.rejects(()=>report(id(5)),/não autorizado/);
 await assert.rejects(()=>report(id(4),null,0,3),/não autorizado/);
 await assert.rejects(()=>report(null,id(122)),/não autorizada/);
 await assert.rejects(()=>report(null,null,-1),/mínima inválida/);
 assert.equal((await asUser(4,'select private.sale_agenda($1) as a',[id(150)])).rows[0].a,null);
 assert.equal((await asUser(2,'select private.sale_agenda($1) as a',[id(150)])).rows[0].a,id(121));
});

test('report details compare real attributed sales by agenda, closing seller and store without exposing other sellers to staff',async()=>{
 await owner("insert into contact_tasks(id,organization_id,store_id,agenda_id,customer_id,assigned_to,due_date,status,outcome,completed_by,completed_at) values($1,$2,$3,$4,$5,$6,'2025-10-08','completed','contacted',$6,'2025-10-08T10:00:00Z')",[id(181),id(100),id(110),id(121),id(130),id(4)]);
 const report=async(user=2,seller=null,agenda=null,minimum=0)=>(await asUser(user,'select report_snapshot($1,$2,$3,$4,$5,$6) as data',[id(110),'2026-10-01','2026-10-20',seller,agenda,minimum])).rows[0].data;
 const manager=await report();
 assert.equal(manager.totals.previous_gross,120);
 assert.equal(manager.by_store.find(row=>row.store_id===id(110)).previous_gross,120);
 assert.equal(manager.by_seller.find(row=>row.seller_id===id(3)).previous_gross,120);
 assert.equal(manager.by_seller.find(row=>row.seller_id===id(4)).previous_gross,0);
 const agenda=manager.by_agenda.find(row=>row.agenda_id===id(121));
 assert.equal(agenda.gross,100);assert.equal(agenda.previous_gross,120);
 assert.equal(agenda.by_seller.length,1);assert.equal(agenda.by_seller[0].seller_id,id(3));
 assert.equal(agenda.by_seller[0].gross,100);assert.equal(agenda.by_seller[0].previous_gross,120);
 assert.equal(agenda.by_store.length,1);assert.equal(agenda.by_store[0].store_id,id(110));
 assert.equal(agenda.by_store[0].gross,100);assert.equal(agenda.by_store[0].previous_gross,120);
 const assisted=await report(4);const ownAgenda=assisted.by_agenda.find(row=>row.agenda_id===id(121));
 assert.equal(assisted.totals.gross,200);assert.equal(assisted.totals.previous_gross,0);
 assert.equal(ownAgenda.gross,100);assert.equal(ownAgenda.previous_gross,120);
 assert.deepEqual(ownAgenda.by_seller,[]);assert.deepEqual(ownAgenda.by_store,[]);
 assert.equal((await asUser(4,'select * from sales where id=$1',[id(180)])).rows.length,0);
 const filtered=await report(2,id(4),id(121));
 assert.equal(filtered.by_agenda[0].previous_gross,0);assert.deepEqual(filtered.by_agenda[0].by_seller,[]);
 assert.equal((await report(2,null,null,150)).by_agenda.find(row=>row.agenda_id===id(121)).previous_gross,0);
});

test('today and yesterday gross use organization local dates, real closing sales and report filters independently of selected interval',async()=>{
 const today=(await owner("select (current_timestamp at time zone 'America/Sao_Paulo')::date::text as today")).rows[0].today;
 for(const [n,org,store,customer,seller,offset,hour,amount,status] of [
 [185,100,110,131,3,0,'00:30',110,'completed'],[186,100,110,131,4,-1,'12:00',240,'completed'],
 [187,100,110,131,3,-1,'23:30',15,'completed'],[188,100,110,131,4,0,'12:00',20,'completed'],
 [189,100,111,132,5,0,'12:00',999,'completed'],[190,101,112,133,7,0,'12:00',9999,'completed'],
 [191,100,110,131,3,0,'12:00',888,'cancelled']]){
 await owner("insert into sales(id,organization_id,store_id,external_id,customer_id,seller_id,sold_at,gross_amount,status) values($1,$2,$3,$4,$5,$6,(($7::date+$8::integer)+$9::time) at time zone 'America/Sao_Paulo',$10,$11)",[id(n),id(org),id(store),`daily-${n}`,id(customer),id(seller),today,offset,hour,amount,status]);}
 const report=async(user=2,store=id(110),seller=null,agenda=null,minimum=0)=>(await asUser(user,'select report_snapshot($1,$2,$3,$4,$5,$6) as data',[store,'2026-10-01','2026-10-20',seller,agenda,minimum])).rows[0].data;
 const manager=await report();assert.equal(manager.totals.today_gross,130);assert.equal(manager.totals.yesterday_gross,255);
 assert.equal(manager.totals.gross,300);
 const own=await report(3);assert.equal(own.totals.today_gross,110);assert.equal(own.totals.yesterday_gross,15);
 const filtered=await report(2,id(110),id(4));assert.equal(filtered.totals.today_gross,20);assert.equal(filtered.totals.yesterday_gross,240);
 const minimum=await report(2,id(110),null,null,100);assert.equal(minimum.totals.today_gross,110);assert.equal(minimum.totals.yesterday_gross,240);
 const agenda=await report(2,id(110),null,id(121));assert.equal(agenda.totals.today_gross,0);assert.equal(agenda.totals.yesterday_gross,0);
 const admin=await report(1,null);assert.equal(admin.totals.today_gross,1129);assert.equal(admin.totals.yesterday_gross,255);
});

test('selected-store teams include both organization administrators only for authorized admins',async()=>{
 await owner('insert into auth.users values($1,$2)',[id(20),'second-admin@example.test']);
 await owner("insert into profiles(id,organization_id,store_id,role,name,email) values($1,$2,null,'admin','Second Administrator',$3)",[id(20),id(100),'second-admin@example.test']);
 await startSession(20);
 const team=async(user,store)=>(await asUser(user,'select report_snapshot($1,$2,$3) as data',[store,'2026-10-01','2026-10-20'])).rows[0].data.profiles;
 const ids=rows=>rows.map(row=>row.id).sort();
 for(const user of [1,20]){
  const kiosk1=await team(user,id(110));
  assert.deepEqual(ids(kiosk1.filter(row=>row.role==='admin')),[id(1),id(20)]);
  assert(kiosk1.some(row=>row.id===id(2)));assert(kiosk1.some(row=>row.id===id(3)));
  assert(!kiosk1.some(row=>row.id===id(5)||row.id===id(9)||row.organization_id!==id(100)));
  const kiosk2=await team(user,id(111));
  assert.deepEqual(ids(kiosk2.filter(row=>row.role==='admin')),[id(1),id(20)]);
  assert(kiosk2.some(row=>row.id===id(5)));assert(!kiosk2.some(row=>row.id===id(3)));
  const all=await team(user,null);
  assert.deepEqual(ids(all.filter(row=>row.role==='admin')),[id(1),id(20)]);
  assert(all.every(row=>row.organization_id===id(100)));
 }
 const manager=await team(2,id(110));
 assert(!manager.some(row=>row.role==='admin'||row.organization_id!==id(100)));
 assert(manager.every(row=>row.store_id===id(110)));
 assert(manager.some(row=>row.id===id(2)));assert(manager.some(row=>row.id===id(3)));
 assert.deepEqual(ids(await team(3,id(110))),[id(3)]);
 const foreign=await team(6,id(112));
 assert.deepEqual(ids(foreign.filter(row=>row.role==='admin')),[id(6)]);
 assert(foreign.every(row=>row.organization_id===id(101)));
});

test('staff roles preserve store history while current permissions and pending assignments change immediately',async t=>{
 for(const n of [30,31,32,33,34,35,36])await owner('insert into auth.users values($1,$2)',[id(n),`roles${n}@example.test`]);
 await owner("insert into organizations(id,name) values($1,'Role management')",[id(200)]);
 await owner("insert into stores(id,organization_id,name) values($1,$2,'Old kiosk'),($3,$2,'New kiosk')",[id(210),id(200),id(211)]);
 for(const [n,store,role] of [[30,null,'admin'],[31,210,'seller'],[32,210,'manager'],[33,211,'seller'],[34,null,'admin'],[35,211,'manager']]){
 await owner('insert into profiles(id,organization_id,store_id,role,name,email,external_id) values($1,$2,$3,$4,$5,$6,$7)',[id(n),id(200),store?id(store):null,role,n===31?'Historical Seller':`Roles ${n}`,`roles${n}@example.test`,`HIST-${n}`]);}
 for(const n of [30,31,32,33,34,35])await startSession(n);
 await owner("insert into agendas(id,organization_id,name,kind) values($1,$2,'History agenda','manual'),($3,$2,'New contacts','manual')",[id(220),id(200),id(221)]);
 await owner("insert into customers(id,organization_id,store_id,external_id,name,phone,responsible_id,last_purchase_at) values($1,$2,$3,'history-customer','History customer','5511999998888',$4,'2026-10-10T12:00:00Z')",[id(230),id(200),id(210),id(31)]);
 await owner("insert into customers(id,organization_id,store_id,external_id,name,phone,responsible_id) values($1,$2,$3,'new-store-customer','New store customer','5511999997777',$4)",[id(231),id(200),id(211),id(33)]);
 await owner("insert into contact_tasks(id,organization_id,store_id,agenda_id,customer_id,assigned_to,status,outcome,completed_by,completed_at,due_date) values($1,$2,$3,$4,$5,$6,'completed','contacted',$6,'2026-10-08T12:00:00Z','2026-10-08')",[id(240),id(200),id(210),id(220),id(230),id(31)]);
 await owner("insert into contact_tasks(id,organization_id,store_id,agenda_id,customer_id,assigned_to,due_date) values($1,$2,$3,$4,$5,$6,'2099-01-01')",[id(241),id(200),id(210),id(220),id(230),id(31)]);
 await owner("insert into sales(id,organization_id,store_id,external_id,customer_id,seller_id,sold_at,gross_amount) values($1,$2,$3,'history-sale',$4,$5,'2026-10-10T12:00:00Z',500)",[id(250),id(200),id(210),id(230),id(31)]);
 await owner("insert into sales_targets(id,organization_id,store_id,seller_id,period_start,amount) values($1,$2,$3,$4,'2026-10-01',1000)",[id(260),id(200),id(210),id(31)]);
 const role=async(user,target,value,store=null)=>(await asUser(user,'select change_staff_role($1,$2,$3) as data',[id(target),value,store?id(store):null])).rows[0].data;
 const report=async(user,store,seller=null)=>(await asUser(user,'select report_snapshot($1,$2,$3,$4) as data',[id(store),'2026-10-01','2026-10-31',seller?id(seller):null])).rows[0].data;

 await t.test('only active same-organization administrators may change valid roles and stores',async()=>{
  await assert.rejects(()=>role(32,31,'admin'),/Somente administradores/);
  await assert.rejects(()=>role(31,31,'admin'),/Somente administradores/);
  await assert.rejects(()=>role(30,7,'admin'),/não autorizado/);
  await assert.rejects(()=>role(30,31,'admin',210),/inválido/);
  await assert.rejects(()=>role(30,31,'manager'),/inválido/);
  await assert.rejects(()=>role(30,31,'seller',112),/inválido/);
  await assert.rejects(()=>role(30,31,'owner'),/inválido/);
  await assert.rejects(()=>asUser(32,'select * from profile_store_memberships'),/permission denied/);
  await assert.rejects(()=>asUser(30,'delete from profile_external_ids'),/permission denied/);
 });

 await t.test('promotion preserves customers, completed contacts, revenue and targets and reports historical names safely',async()=>{
  const promoted=await role(30,31,'admin');assert.equal(promoted.role,'admin');assert.equal(promoted.store_id,null);
  assert.equal((await owner('select assigned_to from contact_tasks where id=$1',[id(241)])).rows[0].assigned_to,null);
  const completed=(await owner('select assigned_to,completed_by from contact_tasks where id=$1',[id(240)])).rows[0];
  assert.equal(completed.assigned_to,id(31));assert.equal(completed.completed_by,id(31));
  assert.equal((await owner('select seller_id from sales where id=$1',[id(250)])).rows[0].seller_id,id(31));
  assert.equal((await owner('select seller_id from sales_targets where id=$1',[id(260)])).rows[0].seller_id,id(31));
  assert.equal((await owner('select responsible_id from customers where id=$1',[id(230)])).rows[0].responsible_id,id(31));
  assert.equal((await asUser(32,'select * from profiles where id=$1',[id(31)])).rows.length,0);
  const history=await report(32,210);assert.equal(history.totals.gross,500);
  const seller=history.by_seller.find(row=>row.seller_id===id(31));assert.equal(seller.gross,500);assert.equal(seller.name,'Historical Seller');
  assert.equal(history.by_agenda.find(row=>row.agenda_id===id(220)).by_seller[0].name,'Historical Seller');
  assert.equal(history.targets.find(row=>row.seller_id===id(31)).amount,1000);
  assert.equal((await report(32,210,31)).totals.gross,500);
  const names=(await asUser(32,'select * from private.report_staff($1)',[id(210)])).rows;
  assert.deepEqual(Object.keys(names[0]).sort(),['name','seller_id','store_id']);
  await assert.rejects(()=>asUser(32,'select * from private.report_staff($1)',[id(211)]),/não autorizado/);
  await assert.rejects(()=>asUser(6,'select * from private.report_staff($1)',[id(210)]),/não autorizado/);
  assert.equal((await asUser(31,'select * from stores')).rows.length,2);
 });

 await t.test('changing store removes old JWT scope and releases pending tasks without granting historical membership access',async()=>{
  await role(30,31,'manager',211);
  assert.deepEqual((await asUser(31,'select id from stores')).rows.map(row=>row.id),[id(211)]);
  assert.equal((await asUser(31,'select * from sales where store_id=$1',[id(210)])).rows.length,0);
  assert.equal((await asUser(31,'select * from customers where store_id=$1',[id(210)])).rows.length,0);
  await assert.rejects(()=>report(31,210),/não autorizado/);
  await assert.rejects(()=>role(31,31,'admin'),/Somente administradores/);
  await role(30,31,'seller',211);
  assert.equal((await asUser(31,'select * from sales_targets where store_id=$1',[id(210)])).rows.length,0);
  const names=(await asUser(31,'select * from private.report_staff(null)')).rows;
  assert(names.every(row=>row.seller_id===id(31)&&row.store_id===id(211)));
  await owner("insert into contact_tasks(id,organization_id,store_id,agenda_id,customer_id,assigned_to,due_date) values($1,$2,$3,$4,$5,$6,'2099-01-02')",[id(242),id(200),id(211),id(220),id(231),id(31)]);
  await assert.rejects(()=>owner("insert into contact_tasks(organization_id,store_id,agenda_id,customer_id,assigned_to,due_date) values($1,$2,$3,$4,$5,'2099-01-03')",[id(200),id(210),id(220),id(230),id(31)]),/mesmo quiosque/);
  await role(30,31,'manager',211);
  assert.equal((await owner('select assigned_to from contact_tasks where id=$1',[id(242)])).rows[0].assigned_to,null);
  await role(30,31,'seller',211);
 });

 await t.test('historical PDV codes allow returns and cancellation reimports after promotion and transfer without assigning new contacts to former staff',async()=>{
  await asUser(30,"select update_staff_profile($1,'Historical Seller','handle','coupon','NEW-31')",[id(31)]);
  const payload={sales:[{external_id:'history-sale',customer_external_id:'history-customer',seller_external_id:'HIST-31',sold_at:'2026-10-10T12:00:00Z',gross_amount:500,returned_amount:25}]};
  await asUser(32,'select import_presence_batch($1,$2)',[id(210),JSON.stringify(payload)]);
  const history=await report(32,210,31);assert.equal(history.totals.gross,500);assert.equal(history.totals.returns,25);
  assert.equal((await owner('select responsible_id from customers where id=$1',[id(230)])).rows[0].responsible_id,id(31));
  await asUser(32,'select generate_agenda_tasks($1,$2)',[id(210),id(221)]);
  const generated=(await owner('select assigned_to from contact_tasks where store_id=$1 and agenda_id=$2 and customer_id=$3',[id(210),id(221),id(230)])).rows;
  assert.equal(generated.length,1);assert.equal(generated[0].assigned_to,null);
  for(const [code,external] of [['HIST-31','new-sale-old-code'],['NEW-31','new-sale-new-code']]){
   await asUser(35,'select import_presence_batch($1,$2)',[id(211),JSON.stringify({sales:[{external_id:external,customer_external_id:'new-store-customer',seller_external_id:code,sold_at:'2026-10-20T12:00:00Z',gross_amount:50}]})]);}
  assert.equal((await owner("select count(*) as n from sales where store_id=$1 and seller_id=$2",[id(211),id(31)])).rows[0].n,2);
  await assert.rejects(()=>asUser(30,"select update_staff_profile($1,'Other seller','','','HIST-31')",[id(33)]),/histórico de outro funcionário/);
  payload.sales[0].status='cancelled';
  await asUser(32,'select import_presence_batch($1,$2)',[id(210),JSON.stringify(payload)]);
  assert.equal((await report(32,210,31)).totals.gross,0);
 });

 await t.test('administrators can edit peers, while demotion and provisioning enforce the last-active-admin rule',async()=>{
  await asUser(30,"select update_staff_profile($1,'Administrator Updated','admin-handle','')",[id(34)]);
  assert.equal((await owner('select name,role from profiles where id=$1',[id(34)])).rows[0].name,'Administrator Updated');
  await assert.rejects(()=>asUser(32,"select update_staff_profile($1,'Forbidden','','')",[id(34)]),/Sem permissão/);
  await asUser(30,'select set_profile_access($1,false)',[id(34)]);
  assert.equal((await asUser(34,'select * from stores')).rows.length,0);
  await assert.rejects(()=>role(34,30,'seller',210),/sem acesso ativo/);
  await asUser(30,'select set_profile_access($1,true)',[id(34)]);
  await role(30,34,'manager',210);
  await assert.rejects(()=>role(30,30,'manager',210),error=>error.detail==='LAST_ACTIVE_ADMIN');
  await assert.rejects(()=>asUser(30,'select set_profile_access($1,false)',[id(30)]),error=>error.detail==='LAST_ACTIVE_ADMIN');
  await asUser(30,"select provision_staff($1,null,'admin','New Administrator',$2)",[id(36),'roles36@example.test']);
  await startSession(36);
  const demoted=await role(30,30,'manager',210);assert.equal(demoted.role,'manager');
  await assert.rejects(()=>asUser(30,'select set_profile_access($1,false)',[id(36)]),/Sem permissão/);
  await assert.rejects(()=>asUser(30,"select provision_staff($1,null,'admin','Forbidden',$2)",[id(19),'user19@example.test']),/Sem permissão/);
  await assert.rejects(()=>role(36,36,'seller',211),error=>error.detail==='LAST_ACTIVE_ADMIN');
  await asUser(36,'select set_profile_access($1,false)',[id(30)]);
  assert.equal((await asUser(30,'select * from profiles')).rows.length,0);
  await assert.rejects(()=>role(30,36,'manager',211),/sem acesso ativo/);
 });
});

test('app sessions enforce idle expiry and return only authorized team presence',async t=>{
 for(const n of [40,41,42,43,44,45,46,47,48,49])await owner('insert into auth.users values($1,$2)',[id(n),`sessions${n}@example.test`]);
 await owner("insert into organizations(id,name) values($1,'Session company'),($2,'Foreign session company')",[id(300),id(301)]);
 await owner("insert into stores(id,organization_id,name) values($1,$2,'Session kiosk'),($3,$2,'Second session kiosk'),($4,$5,'Foreign kiosk')",[id(310),id(300),id(311),id(312),id(301)]);
 for(const [n,org,store,role,active] of [
 [40,300,null,'admin',true],[41,300,310,'manager',true],[42,300,310,'seller',true],
 [43,300,311,'seller',true],[44,301,null,'admin',true],[45,301,312,'seller',true],
 [46,300,310,'seller',false],[47,300,310,'manager',true],[48,300,null,'admin',true],[49,300,310,'seller',true]]){
 await owner('insert into profiles(id,organization_id,store_id,role,name,email,is_active) values($1,$2,$3,$4,$5,$6,$7)',
 [id(n),id(org),store?id(store):null,role,`Session user ${n}`,`sessions${n}@example.test`,active]);}
 for(const n of [40,41,42,43,44,45,47,48])await startSession(n);
 const presence=async(user,store=null)=>(await asUser(user,'select * from team_presence($1)',[store?id(store):null])).rows;
 const ids=rows=>rows.map(row=>row.profile_id).sort();
 const expired=error=>error.code==='P0001'&&error.detail==='APP_SESSION_EXPIRED';

 await t.test('bootstrap uses the signed session, rejects absent claims and gives clients no ledger access',async()=>{
  assert.equal((await asUser(49,'select * from profiles')).rows.length,0);
  await assert.rejects(()=>asUser(49,"select save_own_profile('No session','')"),expired);
  for(const sid of [null,'not-a-uuid']){
   await assert.rejects(()=>asUser(49,'select touch_app_session()',[],sid),error=>error.code==='42501'&&error.detail==='APP_SESSION_REQUIRED');
   assert.equal((await asUser(49,'select * from stores',[],sid)).rows.length,0);
  }
  await startSession(49);
  assert.equal((await asUser(49,'select * from profiles')).rows.length,1);
  const result=(await asUser(49,'select touch_app_session() as session')).rows[0].session;
  assert.deepEqual(Object.keys(result).sort(),['expires_at','last_activity_at','last_seen_at']);
  assert.equal(Date.parse(result.expires_at)-Date.parse(result.last_activity_at),3600000);
  assert.equal((await owner('select count(*) as n from app_sessions where session_id=$1',[sessionId(49)])).rows[0].n,1);
  for(const sql of ['select * from app_sessions',"update app_sessions set last_activity_at=now()",'delete from app_sessions',
   'insert into app_sessions(session_id,profile_id) values(gen_random_uuid(),auth.uid())']){
   await assert.rejects(()=>asUser(40,sql),/permission denied/);
  }
  await assert.rejects(()=>asUser(49,'select private.app_session_id()'),/permission denied/);
  await assert.rejects(()=>asUser(49,'select touch_app_session()',[],sessionId(42)),error=>error.code==='42501');
  await assert.rejects(()=>asUser(49,'select end_app_session()',[],sessionId(42)),error=>error.code==='42501');
  await assert.rejects(()=>asUser(46,'select touch_app_session()'),/sem acesso ativo/);
  await db.exec('reset role;set role anon');
  for(const sql of ['select touch_app_session()','select end_app_session()','select * from team_presence()']){
   await assert.rejects(()=>db.query(sql),/permission denied/);
  }
 });

 await t.test('presence follows profile/store visibility and never exposes device or timestamp metadata',async()=>{
  assert.deepEqual(ids(await presence(40)),[40,41,42,43,46,47,48,49].map(id).sort());
  const selected=await presence(40,310);
  assert.deepEqual(ids(selected),[40,41,42,46,47,48,49].map(id).sort());
  for(const row of selected)assert.deepEqual(Object.keys(row).sort(),['is_online','profile_id']);
  assert.equal(selected.find(row=>row.profile_id===id(46)).is_online,false);
  assert.deepEqual(ids(await presence(41)),[41,42,46,49].map(id).sort());
  assert.deepEqual(ids(await presence(41,310)),[41,42,46,49].map(id).sort());
  assert.deepEqual(ids(await presence(42)),[id(42)]);
  assert.deepEqual(ids(await presence(44)),[44,45].map(id).sort());
  await assert.rejects(()=>presence(41,311),/não autorizado/);
  await assert.rejects(()=>presence(40,312),/não autorizado/);
  await assert.rejects(()=>presence(42,311),/não autorizado/);
 });

 await t.test('90-second heartbeat expiry is separate from activity and any live device keeps the dot online',async()=>{
  const online=async()=> (await presence(41)).find(row=>row.profile_id===id(42)).is_online;
  await owner("update app_sessions set last_seen_at=clock_timestamp()-interval '90 seconds',last_activity_at=clock_timestamp()-interval '30 minutes' where session_id=$1",[sessionId(42)]);
  assert.equal(await online(),false);
  const before=(await owner('select last_activity_at from app_sessions where session_id=$1',[sessionId(42)])).rows[0].last_activity_at;
  await asUser(42,'select touch_app_session(false)');
  const after=(await owner('select last_seen_at,last_activity_at from app_sessions where session_id=$1',[sessionId(42)])).rows[0];
  assert.equal(after.last_activity_at.toISOString(),before.toISOString());
  assert(after.last_seen_at>after.last_activity_at);
  assert.equal(await online(),true);
  await asUser(42,'select touch_app_session(true)');
  assert((await owner('select last_activity_at from app_sessions where session_id=$1',[sessionId(42)])).rows[0].last_activity_at>before);
  await startSession(42,1);
  await owner("update app_sessions set last_activity_at=clock_timestamp()-interval '1 hour' where session_id=$1",[sessionId(42)]);
  assert.equal(await online(),true);
  await asUser(42,'select end_app_session()',[],sessionId(42,1));
  assert.equal(await online(),false);
  for(const device of [0,1])for(const active of [false,true]){
   await assert.rejects(()=>asUser(42,'select touch_app_session($1)',[active],sessionId(42,device)),expired);
  }
  await startSession(42,2);
  assert.equal(await online(),true);
  await owner('update profiles set is_active=false where id=$1',[id(42)]);
  assert.equal(await online(),false);
  await assert.rejects(()=>asUser(42,'select touch_app_session(false)',[],sessionId(42,2)),/sem acesso ativo/);
  await owner('update profiles set is_active=true where id=$1',[id(42)]);
 });

 await t.test('one hour without interaction blocks every RLS helper and business RPC even with a valid JWT',async()=>{
  await owner("update app_sessions set last_activity_at=clock_timestamp()-interval '59 minutes' where session_id=$1",[sessionId(40)]);
  await asUser(40,'select touch_app_session(false)');
  assert((await asUser(40,'select * from profiles')).rows.length>0);
  await owner("update app_sessions set last_activity_at=clock_timestamp()-interval '1 hour',last_seen_at=clock_timestamp() where session_id=$1",[sessionId(40)]);
  const helpers=(await asUser(40,'select private.current_org() as org,private.current_role() as role,private.can_store($1) as store,private.can_manage($1) as manage',[id(310)])).rows[0];
  assert.deepEqual(helpers,{org:null,role:null,store:false,manage:false});
  for(const table of ['organizations','stores','profiles','customers','agendas','contact_tasks','sales','sales_targets','sync_runs','audit_log']){
   assert.equal((await asUser(40,`select * from ${table}`)).rows.length,0,table);
  }
  const guarded=[
   ['select private.require_active()'],
   ["select save_own_profile('Expired','')"],
   ['select save_target($1,$2,current_date,1)',[id(310),id(42)]],
   ['select import_presence_batch($1,$2)',[id(310),'{}']],
   ['select assign_contacts($1,$2,1,$3)',[id(310),id(120),[id(42)]]],
   ["select complete_contact($1,'contacted')",[id(140)]],
   ['select generate_agenda_tasks($1,$2)',[id(310),id(120)]],
   ["select change_staff_role($1,'manager',$2)",[id(49),id(310)]],
   ['select set_profile_access($1,false)',[id(49)]],
   ["select update_staff_profile($1,'Expired','','')",[id(49)]],
   ["select provision_staff($1,$2,'seller','Expired',$3)",[id(19),id(310),'user19@example.test']],
   ['select report_snapshot($1,current_date,current_date)',[id(310)]],
   ['select * from team_presence()'],
   ['select * from private.report_staff($1)',[id(310)]],
   ['select private.sale_agenda($1)',[id(150)]],
   ['select private.seller_contact_metrics($1,current_date,current_date)',[id(310)]],
   ['select private.validate_report_filters($1,current_date,current_date,null,null,0)',[id(310)]]
  ];
  for(const [sql,params=[]] of guarded)await assert.rejects(()=>asUser(40,sql,params),expired,sql);
  for(const active of [false,true])await assert.rejects(()=>asUser(40,'select touch_app_session($1)',[active]),expired);
  const stale=(await owner('select last_activity_at,last_seen_at from app_sessions where session_id=$1',[sessionId(40)])).rows[0];
  assert(stale.last_seen_at-stale.last_activity_at>=3600000);
  await startSession(40,1);
  assert((await asUser(40,'select * from profiles',[],sessionId(40,1))).rows.length>0);
  // A newly authenticated device cannot restore the old session ID.
  await assert.rejects(()=>asUser(40,'select touch_app_session(true)'),expired);
 });

 await t.test('logout is idempotent, ends only that device and tombstones even a session with no heartbeat',async()=>{
  await startSession(49,1);
  await asUser(49,'select end_app_session()');
  const ended=(await owner('select ended_at from app_sessions where session_id=$1',[sessionId(49)])).rows[0].ended_at;
  await asUser(49,'select end_app_session()');
  assert.equal((await owner('select ended_at from app_sessions where session_id=$1',[sessionId(49)])).rows[0].ended_at.toISOString(),ended.toISOString());
  await assert.rejects(()=>asUser(49,'select touch_app_session(true)'),expired);
  assert.equal((await asUser(49,'select * from profiles')).rows.length,0);
  assert.equal((await asUser(49,'select * from profiles',[],sessionId(49,1))).rows.length,1);
  assert.equal((await presence(41)).find(row=>row.profile_id===id(49)).is_online,true);
  await asUser(49,'select end_app_session()',[],sessionId(49,2));
  await assert.rejects(()=>startSession(49,2),expired);
  await asUser(49,'select end_app_session()',[],sessionId(49,1));
  assert.equal((await presence(41)).find(row=>row.profile_id===id(49)).is_online,false);
 });
});
