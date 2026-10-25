import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi,validateImport} from '../netlify/functions/_shared/api-handler.js';
import {createSyncJob} from '../netlify/functions/_shared/sync-job.js';
const ids={actor:'11111111-1111-4111-8111-111111111111',store:'22222222-2222-4222-8222-222222222222',other:'33333333-3333-4333-8333-333333333333',org:'44444444-4444-4444-8444-444444444444',target:'55555555-5555-4555-8555-555555555555'};
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public-key',SUPABASE_SERVICE_ROLE_KEY:'server-key',APP_URL:'https://valance.example'};
function fixture({role='admin',active=true,authError=false,targetRole='seller'}={}){
 const calls=[],me={id:ids.actor,organization_id:ids.org,store_id:role==='admin'?null:ids.store,role,name:'Gerente',email:'manager@example.com',is_active:active};
 function query(table){const state={table};const q={select(){return q;},eq(k,v){state[k]=v;return q;},order(){return q;},limit(){return q;},maybeSingle:async()=>({data:table==='profiles'?(state.id===ids.actor?me:{id:ids.target,organization_id:ids.org,store_id:ids.store,role:targetRole,email:'staff@example.com',is_active:true}):table==='stores'?{id:state.id,organization_id:ids.org}: {id:ids.org,name:'Empresa',timezone:'America/Sao_Paulo'},error:null}),insert:async data=>{calls.push(['insert',table,data]);return {data:null,error:null};},then(resolve,reject){return Promise.resolve({data:table==='stores'?[{id:ids.store,organization_id:ids.org}]:[],error:null}).then(resolve,reject);}};return q;}
 const client={auth:{getUser:async()=>({data:{user:authError?null:{id:ids.actor}},error:authError?{}:null})},from:query,rpc:async(name,args)=>{calls.push(['rpc',name,args]);return {data:{ok:true},error:null};}};
 const service={auth:{admin:{inviteUserByEmail:async(email,options)=>{calls.push(['invite',email,options]);return {data:{user:{id:ids.target}},error:null};},deleteUser:async id=>{calls.push(['delete',id]);return {error:null};},updateUserById:async(id,data)=>{calls.push(['ban',id,data]);return {error:null};}},resetPasswordForEmail:async(email,options)=>{calls.push(['reset',email,options]);return {error:null};}},from:query};
 return {calls,api:createApi({env,createClient:(_url,key)=>{calls.push(['client',key==='server-key'?'service':'user']);return key==='server-key'?service:client;}})};
}
const request=(action,body,extra={})=>new Request(`https://valance.example/.netlify/functions/api?action=${action}`,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer valid-token',...(body===undefined?{}:{'content-type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
test('authentication and disabled profiles deny every operation before service access',async()=>{
 for(const opts of [{authError:true},{active:false}]){const f=fixture(opts);const response=await f.api(request('session-info'));assert.equal(response.status,opts.authError?401:403);assert(!f.calls.some(c=>c[0]==='client'&&c[1]==='service'));}
 const f=fixture();assert.equal((await f.api(new Request('https://valance.example/?action=session-info'))).status,401);
});
test('manager cannot import another store or invite an elevated role; seller cannot import',async()=>{
 const payload={customers:[{external_id:'c1',name:'Cliente'}]};
 const manager=fixture({role:'manager'});assert.equal((await manager.api(request('import-presence',{store_id:ids.other,payload}))).status,403);
 assert.equal((await manager.api(request('invite-user',{store_id:ids.store,email:'a@example.com',name:'A',role:'manager'}))).status,403);
 const seller=fixture({role:'seller'});assert.equal((await seller.api(request('import-presence',{store_id:ids.store,payload}))).status,403);
 assert(!manager.calls.some(c=>c[0]==='invite'));assert(!seller.calls.some(c=>c[0]==='rpc'));
});
test('authorized normalized import uses caller RPC, rejects injected org, and preserves absent references',async()=>{
 const f=fixture({role:'manager'}),payload={customers:[{external_id:'c1',name:'Cliente'}],sales:[{external_id:'s1',sold_at:'2026-10-25T14:00:00-03:00',gross_amount:120}]};
 assert.equal((await f.api(request('import-presence',{store_id:ids.store,payload}))).status,200);
 const call=f.calls.find(c=>c[0]==='rpc');assert.equal(call[1],'import_presence_batch');assert.equal(Object.hasOwn(call[2].p_payload.sales[0],'seller_external_id'),false);assert.equal(Object.hasOwn(call[2].p_payload.sales[0],'status'),false);
 assert.equal((await f.api(request('import-presence',{store_id:ids.store,organization_id:ids.other,payload}))).status,400);
 assert(!f.calls.some(c=>c[0]==='client'&&c[1]==='service'));
});
test('import validators reject repeated IDs, malformed records, negative money, and oversized batches',()=>{
 const customer={external_id:'c1',name:'Cliente'};assert.throws(()=>validateImport({customers:[customer,customer]}));assert.throws(()=>validateImport({customers:Array.from({length:501},(_,n)=>({...customer,external_id:String(n)}))}));
 assert.throws(()=>validateImport({sales:[{external_id:'s1',sold_at:'yesterday',gross_amount:1}]}));
 assert.throws(()=>validateImport({sales:[{external_id:'s1',sold_at:'2026-10-25T14:00:00Z',gross_amount:-1}]}));
 assert.throws(()=>validateImport({customers:[{...customer,organization_id:ids.other}]}));
});
test('sparse customer import preserves absent fields through validator and caller RPC payload',async()=>{
 const payload={customers:[{external_id:'c1',name:'Nome atualizado'}]};
 const clean=validateImport(payload).customers[0];assert.equal(Object.hasOwn(clean,'phone'),false);assert.equal(Object.hasOwn(clean,'birth_date'),false);assert.equal(Object.hasOwn(clean,'responsible_external_id'),false);
 const explicit=validateImport({customers:[{external_id:'c1',name:'Nome atualizado',phone:'',birth_date:null}]}).customers[0];assert.equal(explicit.phone,null);assert.equal(explicit.birth_date,null);
 const f=fixture({role:'manager'});const response=await f.api(request('import-presence',{store_id:ids.store,payload}));assert.equal(response.status,200);const row=f.calls.find(c=>c[0]==='rpc'&&c[1]==='import_presence_batch')[2].p_payload.customers[0];assert.deepEqual(row,{external_id:'c1',name:'Nome atualizado'});
});
test('sparse sale updates preserve optional fields and permit explicit reference clearing',async()=>{
 const sale={external_id:'s1',sold_at:'2026-10-25T14:00:00Z',gross_amount:120};
 const f=fixture({role:'manager'});const response=await f.api(request('import-presence',{store_id:ids.store,payload:{sales:[sale]}}));assert.equal(response.status,200);
 const clean=f.calls.find(c=>c[0]==='rpc'&&c[1]==='import_presence_batch')[2].p_payload.sales[0];assert.deepEqual(clean,sale);
 const explicit=validateImport({sales:[{...sale,customer_external_id:null,seller_external_id:'',discount_amount:0,returned_amount:0,status:'cancelled'}]}).sales[0];assert.equal(explicit.customer_external_id,null);assert.equal(explicit.seller_external_id,null);assert.equal(explicit.discount_amount,0);assert.equal(explicit.returned_amount,0);assert.equal(explicit.status,'cancelled');
 for(const key of ['discount_amount','returned_amount'])assert.throws(()=>validateImport({sales:[{...sale,[key]:null}]}));
 assert.throws(()=>validateImport({sales:[{...sale,status:null}]}));
});
test('invitation provisions profile through authenticated RPC and never returns credentials',async()=>{
 const f=fixture();const r=await f.api(request('invite-user',{store_id:ids.store,email:'Staff@Example.com',name:'Equipe',role:'seller',external_id:'PDV-17'}));assert.equal(r.status,201);const data=await r.json();assert.deepEqual(data,{user_id:ids.target,status:'invited'});const invite=f.calls.find(c=>c[0]==='invite');assert.equal(invite[2].redirectTo,'https://valance.example/?auth=invite');assert(f.calls.some(c=>c[0]==='rpc'&&c[1]==='provision_staff'));assert(!f.calls.some(c=>c[0]==='insert'&&c[1]==='profiles'));
});
test('staff edit allows empty optional handle and coupon as database empty strings',async()=>{
 const f=fixture();const response=await f.api(request('update-user',{user_id:ids.target,name:'Nome atualizado',handle:'',coupon:'',external_id:'PDV-1'}));assert.equal(response.status,200);const call=f.calls.find(c=>c[0]==='rpc'&&c[1]==='update_staff_profile');assert.equal(call[2].p_handle,'');assert.equal(call[2].p_coupon,'');assert.equal(call[2].p_external_id,'PDV-1');
});
test('deactivation first applies DB permission gate and then bans authentication',async()=>{
 const f=fixture();assert.equal((await f.api(request('set-access',{user_id:ids.target,is_active:false}))).status,200);assert(f.calls.findIndex(c=>c[0]==='rpc'&&c[1]==='set_profile_access')<f.calls.findIndex(c=>c[0]==='ban'));assert.equal(f.calls.find(c=>c[0]==='ban')[2].ban_duration,'876000h');
});
test('unsafe origin, missing configuration and unsupported actions fail closed',async()=>{
 const f=fixture();assert.equal((await f.api(request('import-presence',{}, {origin:'https://attacker.example'}))).status,403);assert.equal((await f.api(request('unknown'))).status,404);
 const unavailable=createApi({env:{},createClient:()=>{throw Error('must not run');}});assert.equal((await unavailable(request('session-info'))).status,503);
});
test('scheduled integration without documented adapter never accesses database or tenant metadata',async()=>{
 let called=false;
 for(const configured of [{},env]){const run=createSyncJob({env:configured,createClient:()=>{called=true;throw Error('must not run');}});const response=await run();assert.equal(response.status,503);assert.deepEqual(await response.json(),{status:'blocked',code:'PRESENCE_NOT_CONFIGURED'});}
 assert.equal(called,false);
});
