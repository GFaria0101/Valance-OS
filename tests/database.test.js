import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function asUser(user,sql,params=[]){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(user)]);await db.exec('set role authenticated');return db.query(sql,params);}
async function owner(sql,params=[]){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");return db.query(sql,params);}
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
 const migrations=new URL('../supabase/migrations/',import.meta.url);
 for(const migration of (await readdir(migrations)).filter(name=>name.endsWith('.sql')).sort()){
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
 await assert.rejects(()=>asUser(1,'select set_profile_access($1,false)',[id(1)]),/Sem permissão/);
 await asUser(3,"select save_own_profile('Seller Updated','seller-handle')");
 assert.equal((await owner('select role from profiles where id=$1',[id(3)])).rows[0].role,'seller');
 await assert.rejects(()=>asUser(3,'select save_target($1,$2,$3,$4)',[id(110),id(3),'2026-10-01',1000]),/Sem permissão/);
 await asUser(2,'select save_target($1,$2,$3,$4)',[id(110),id(3),'2026-10-01',1000]);
 await asUser(2,'select save_target($1,$2,$3,$4)',[id(110),id(3),'2026-10-01',1500]);
 assert.equal((await owner('select count(*) as n from sales_targets')).rows[0].n,1);
});

test('distribution is atomic, rejects cross-store/inactive sellers and duplicate allocation',async()=>{
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
