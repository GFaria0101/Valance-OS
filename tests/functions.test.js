import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi,validateImport} from '../netlify/functions/_shared/api-handler.js';
import {createSyncJob} from '../netlify/functions/_shared/sync-job.js';
const ids={actor:'11111111-1111-4111-8111-111111111111',store:'22222222-2222-4222-8222-222222222222',other:'33333333-3333-4333-8333-333333333333',org:'44444444-4444-4444-8444-444444444444',target:'55555555-5555-4555-8555-555555555555'};
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public-key',SUPABASE_SERVICE_ROLE_KEY:'server-key',APP_URL:'https://valance.example'};
function fixture({role='admin',active=true,authError=false,targetRole='seller',targetOrg=ids.org,targetStore=ids.store,storeOrg=ids.org,touchError=null,profileError=null,rpcError=null,authUpdateError=null}={}){
 const calls=[],me={id:ids.actor,organization_id:ids.org,store_id:role==='admin'?null:ids.store,role,name:'Gerente',email:'manager@example.com',is_active:active};
 function query(table){calls.push(['from',table]);const state={table};const q={select(){return q;},eq(k,v){state[k]=v;return q;},order(){return q;},limit(){return q;},maybeSingle:async()=>({data:table==='profiles'?(state.id===ids.actor?me:{id:ids.target,organization_id:targetOrg,store_id:targetRole==='admin'?null:targetStore,role:targetRole,email:'staff@example.com',is_active:true}):table==='stores'?{id:state.id,organization_id:storeOrg}: {id:ids.org,name:'Empresa',timezone:'America/Sao_Paulo'},error:table==='profiles'&&state.id===ids.actor?profileError:null}),insert:async data=>{calls.push(['insert',table,data]);return {data:null,error:null};},then(resolve,reject){return Promise.resolve({data:table==='stores'?[{id:ids.store,organization_id:ids.org}]:[],error:null}).then(resolve,reject);}};return q;}
 const client={auth:{getUser:async()=>{calls.push(['getUser']);return {data:{user:authError?null:{id:ids.actor}},error:authError?{}:null};}},from:query,rpc:async(name,args)=>{calls.push(['rpc',name,args]);const error=name==='touch_app_session'?touchError:rpcError;return {data:error?null:name==='touch_app_session'?{last_activity_at:'2026-11-08T12:00:00Z',last_seen_at:'2026-11-08T12:30:00Z',expires_at:'2026-11-08T13:00:00Z'}:{ok:true},error};}};
 const service={auth:{admin:{inviteUserByEmail:async(email,options)=>{calls.push(['invite',email,options]);return {data:{user:{id:ids.target}},error:null};},deleteUser:async id=>{calls.push(['delete',id]);return {error:null};},updateUserById:async(id,data)=>{calls.push(['ban',id,data]);return {error:authUpdateError};}},resetPasswordForEmail:async(email,options)=>{calls.push(['reset',email,options]);return {error:null};}},from:query};
 return {calls,api:createApi({env,createClient:(_url,key)=>{calls.push(['client',key==='server-key'?'service':'user']);return key==='server-key'?service:client;}})};
}
const request=(action,body,extra={})=>new Request(`https://valance.example/.netlify/functions/api?action=${action}`,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer valid-token',...(body===undefined?{}:{'content-type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
const mutationCall=call=>call[0]==='rpc'&&call[1]!=='touch_app_session';
const sessionExpired={error:'Sua sessão expirou por inatividade. Entre novamente.',code:'APP_SESSION_EXPIRED'};
test('authentication and disabled profiles deny every operation before service access',async()=>{
 for(const opts of [{authError:true},{active:false}]){const f=fixture(opts);const response=await f.api(request('session-info'));assert.equal(response.status,opts.authError?401:403);assert(!f.calls.some(c=>c[0]==='client'&&c[1]==='service'));if(opts.authError)assert.deepEqual(f.calls,[['client','user'],['getUser']]);else assert.deepEqual(f.calls,[['client','user'],['getUser'],['rpc','touch_app_session',{p_active:false}],['from','profiles']]);}
 const f=fixture();assert.equal((await f.api(new Request('https://valance.example/?action=session-info'))).status,401);
});
test('validated auth bootstraps the server session before profiles without recording activity',async()=>{
 const f=fixture();
 for(const action of ['session-info','health','sync-state'])assert.equal((await f.api(request(action))).status,200);
 assert.deepEqual(f.calls.slice(0,4),[['client','user'],['getUser'],['rpc','touch_app_session',{p_active:false}],['from','profiles']]);
 assert.deepEqual(f.calls.filter(c=>c[0]==='rpc'),Array.from({length:3},()=>['rpc','touch_app_session',{p_active:false}]));
});
test('expired or unregistered server session blocks every route before data queries and service state',async()=>{
 const routes=[['session-info'],['health'],['sync-state'],['invite-user',{store_id:ids.store,email:'staff@example.com',name:'Equipe',role:'seller'}],['update-user',{user_id:ids.target,name:'Equipe'}],['change-role',{user_id:ids.target,role:'seller',store_id:ids.store}],['set-access',{user_id:ids.target,is_active:true}],['reset-user',{user_id:ids.target}],['import-presence',{store_id:ids.store,payload:{customers:[{external_id:'c1',name:'Cliente'}]}}],['sync-presence',{store_id:ids.store}]];
 for(const [code,details]of [['P0001','APP_SESSION_EXPIRED'],['42501','APP_SESSION_REQUIRED']])for(const [action,body]of routes){
   const f=fixture({touchError:{code,details,message:'private database data; valid-token; server-key'}});
   const response=await f.api(request(action,body));assert.equal(response.status,401,action);assert.deepEqual(await response.json(),sessionExpired);
   assert.deepEqual(f.calls,[['client','user'],['getUser'],['rpc','touch_app_session',{p_active:false}]],action);
 }
});
test('client session claims cannot bypass the server touch or request an activity update',async()=>{
 const f=fixture({touchError:{code:'42501',details:'APP_SESSION_REQUIRED'}});
 const response=await f.api(request('set-access',{user_id:ids.target,is_active:true,session_id:ids.other,p_active:true},{'x-app-session-id':ids.other,'x-app-session-active':'true'}));
 assert.equal(response.status,401);assert.deepEqual(await response.json(),sessionExpired);
 assert.deepEqual(f.calls,[['client','user'],['getUser'],['rpc','touch_app_session',{p_active:false}]]);
});
test('session errors during profile lookup and action RPCs preserve the same expiry response',async()=>{
 for(const [code,details]of [['P0001','APP_SESSION_EXPIRED'],['42501','APP_SESSION_REQUIRED']]){
   const error={code,details,message:'private database data; valid-token; server-key'};
   const profile=fixture({profileError:error});const denied=await profile.api(request('session-info'));assert.equal(denied.status,401);assert.deepEqual(await denied.json(),sessionExpired);assert.equal(profile.calls.filter(c=>c[0]==='from').length,1);
   for(const [action,body,rpc]of [['import-presence',{store_id:ids.store,payload:{customers:[{external_id:'c1',name:'Cliente'}]}},'import_presence_batch'],['update-user',{user_id:ids.target,name:'Equipe'},'update_staff_profile'],['change-role',{user_id:ids.target,role:'seller',store_id:ids.store},'change_staff_role'],['set-access',{user_id:ids.target,is_active:true},'set_profile_access'],['invite-user',{store_id:ids.store,email:'staff@example.com',name:'Equipe',role:'seller'},'provision_staff']]){
     const f=fixture({rpcError:error});const response=await f.api(request(action,body));assert.equal(response.status,401,action);assert.deepEqual(await response.json(),sessionExpired);assert(f.calls.some(c=>c[0]==='rpc'&&c[1]===rpc));assert(!f.calls.some(c=>c[0]==='ban'));
   }
 }
});
test('only exact session details receive the expiry response and other permissions stay forbidden',async()=>{
 for(const error of [{code:'P0001',details:'APP_SESSION_EXPIRED private suffix'},{code:'42501',details:'APP_SESSION_REQUIRED private suffix'},{code:'42501',message:'APP_SESSION_REQUIRED'}]){
   const f=fixture({touchError:error});const response=await f.api(request('health'));assert.equal(response.status,error.code==='P0001'?400:403);const body=await response.json();assert.equal(Object.hasOwn(body,'code'),false);assert.doesNotMatch(body.error,/APP_SESSION|private/);assert(!f.calls.some(c=>c[0]==='from'));
 }
});
test('manager cannot import another store or invite an elevated role; seller cannot import',async()=>{
 const payload={customers:[{external_id:'c1',name:'Cliente'}]};
 const manager=fixture({role:'manager'});assert.equal((await manager.api(request('import-presence',{store_id:ids.other,payload}))).status,403);
 assert.equal((await manager.api(request('invite-user',{store_id:ids.store,email:'a@example.com',name:'A',role:'manager'}))).status,403);
 const seller=fixture({role:'seller'});assert.equal((await seller.api(request('import-presence',{store_id:ids.store,payload}))).status,403);
 assert(!manager.calls.some(c=>c[0]==='invite'));assert(!seller.calls.some(mutationCall));
});
test('authorized normalized import uses caller RPC, rejects injected org, and preserves absent references',async()=>{
 const f=fixture({role:'manager'}),payload={customers:[{external_id:'c1',name:'Cliente'}],sales:[{external_id:'s1',sold_at:'2026-10-25T14:00:00-03:00',gross_amount:120}]};
 assert.equal((await f.api(request('import-presence',{store_id:ids.store,payload}))).status,200);
 const call=f.calls.find(c=>c[0]==='rpc'&&c[1]==='import_presence_batch');assert.equal(Object.hasOwn(call[2].p_payload.sales[0],'seller_external_id'),false);assert.equal(Object.hasOwn(call[2].p_payload.sales[0],'status'),false);
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
test('deactivation changes only the authoritative database profile and never creates an Auth ban',async()=>{
 const f=fixture();assert.equal((await f.api(request('set-access',{user_id:ids.target,is_active:false}))).status,200);assert.deepEqual(f.calls.find(c=>c[0]==='rpc'&&c[1]==='set_profile_access'),['rpc','set_profile_access',{p_profile_id:ids.target,p_active:false}]);assert(!f.calls.some(c=>c[0]==='ban'||c[0]==='client'&&c[1]==='service'));
});
test('reactivation clears legacy Auth bans after the database gate and reports failures as pending',async()=>{
 const f=fixture();assert.equal((await f.api(request('set-access',{user_id:ids.target,is_active:true}))).status,200);assert(f.calls.findIndex(c=>c[0]==='rpc'&&c[1]==='set_profile_access')<f.calls.findIndex(c=>c[0]==='ban'));assert.deepEqual(f.calls.find(c=>c[0]==='ban'),['ban',ids.target,{ban_duration:'none'}]);
 const failing=fixture({authUpdateError:{message:'private server-key'}});const response=await failing.api(request('set-access',{user_id:ids.target,is_active:true}));assert.equal(response.status,503);const body=await response.json();assert.equal(body.code,'AUTH_UPDATE_PENDING');assert.equal(body.database_active,true);assert.doesNotMatch(JSON.stringify(body),/private|server-key/);
 const denied=fixture({rpcError:{code:'42501',message:'private error'}});assert.equal((await denied.api(request('set-access',{user_id:ids.target,is_active:true}))).status,403);assert(!denied.calls.some(c=>c[0]==='ban'));
});
test('administrator can edit, recover and deactivate another administrator within the same organization',async()=>{
 const f=fixture({targetRole:'admin'});
 assert.equal((await f.api(request('update-user',{user_id:ids.target,name:'Outro administrador',handle:'',coupon:''}))).status,200);
 const reset=await f.api(request('reset-user',{user_id:ids.target}));assert.equal(reset.status,200);assert.deepEqual(await reset.json(),{status:'recovery_sent'});
 const recovery=f.calls.find(c=>c[0]==='reset');assert.equal(recovery[1],'staff@example.com');assert.equal(recovery[2].redirectTo,'https://valance.example/?auth=recovery');
 assert.equal((await f.api(request('set-access',{user_id:ids.target,is_active:false}))).status,200);
 assert(f.calls.some(c=>c[0]==='rpc'&&c[1]==='set_profile_access'));
 assert.equal((await f.api(request('reset-user',{user_id:ids.target,email:'attacker@example.com'}))).status,400,'recovery recipient cannot be overridden');
 assert.equal(f.calls.filter(c=>c[0]==='reset').length,1);
});
test('administrator invitation accepts an organization role with null store and never returns credentials',async()=>{
 const f=fixture();const response=await f.api(request('invite-user',{store_id:null,email:'Admin@Example.com',name:'Novo administrador',role:'admin'}));
 assert.equal(response.status,201);assert.deepEqual(await response.json(),{user_id:ids.target,status:'invited'});
 const rpc=f.calls.find(c=>c[0]==='rpc'&&c[1]==='provision_staff');assert.equal(rpc[2].p_store_id,null);assert.equal(rpc[2].p_role,'admin');assert.equal(rpc[2].p_email,'admin@example.com');
 assert(!f.calls.some(c=>c[0]==='insert'));
});
test('role changes use the authenticated database RPC for promotions and demotions without Auth metadata mutations',async()=>{
 for(const [role,store_id]of [['admin',null],['manager',ids.store],['seller',ids.store]]){
   const f=fixture({targetRole:'admin'});const response=await f.api(request('change-role',{user_id:ids.target,role,store_id}));assert.equal(response.status,200);
   assert.deepEqual(f.calls.find(c=>c[0]==='rpc'&&c[1]==='change_staff_role'),['rpc','change_staff_role',{p_profile_id:ids.target,p_role:role,p_store_id:store_id}]);
   assert(!f.calls.some(c=>c[0]==='client'&&c[1]==='service'));
   const output=await response.text();assert.doesNotMatch(output,/server-key|valid-token|password|access_token|refresh_token/);
 }
});
test('manager and seller cannot promote, invite or manage administrators',async()=>{
 for(const role of ['manager','seller']){
   const f=fixture({role,targetRole:'admin'});
   for(const [action,body]of [['change-role',{user_id:ids.target,role:'admin',store_id:null}],['invite-user',{email:'a@example.com',name:'A',role:'admin',store_id:null}],['update-user',{user_id:ids.target,name:'A',handle:'',coupon:''}],['reset-user',{user_id:ids.target}],['set-access',{user_id:ids.target,is_active:false}]])assert.equal((await f.api(request(action,body))).status,403,`${role} cannot ${action}`);
   assert(!f.calls.some(c=>mutationCall(c)||['invite','reset','ban'].includes(c[0])));assert(!f.calls.some(c=>c[0]==='client'&&c[1]==='service'));
 }
 const manager=fixture({role:'manager',targetStore:ids.other});assert.equal((await manager.api(request('update-user',{user_id:ids.target,name:'A'}))).status,403);
});
test('cross-organization staff and destination stores are rejected before any mutation or recovery',async()=>{
 const f=fixture({targetOrg:ids.other,targetRole:'admin'});
 for(const [action,body]of [['change-role',{user_id:ids.target,role:'seller',store_id:ids.store}],['update-user',{user_id:ids.target,name:'A'}],['reset-user',{user_id:ids.target}],['set-access',{user_id:ids.target,is_active:false}]])assert.equal((await f.api(request(action,body))).status,403);
 assert(!f.calls.some(c=>mutationCall(c)||['invite','reset','ban'].includes(c[0])));
 const foreignStore=fixture({storeOrg:ids.other});assert.equal((await foreignStore.api(request('change-role',{user_id:ids.target,role:'seller',store_id:ids.store}))).status,403);assert(!foreignStore.calls.some(mutationCall));
});
test('role and store assignments reject malformed values and unknown authority fields',async()=>{
 const invalid=[{role:'superadmin',store_id:null},{role:"admin;drop table profiles",store_id:null},{role:'admin',store_id:ids.store},{role:'admin'},{role:'manager',store_id:null},{role:'seller',store_id:['bad']},{role:'seller',store_id:'not-a-uuid'},{role:'seller',store_id:ids.store,organization_id:ids.other}];
 for(const assignment of invalid){
   const change=fixture();assert.equal((await change.api(request('change-role',{user_id:ids.target,...assignment}))).status,400);assert(!change.calls.some(mutationCall));
   const invite=fixture();assert.equal((await invite.api(request('invite-user',{name:'A',email:'a@example.com',...assignment}))).status,400);assert(!invite.calls.some(c=>c[0]==='invite'));
 }
 assert.equal((await fixture().api(request('change-role',{user_id:'invalid',role:'admin',store_id:null}))).status,400);
});
test('database last-administrator guards block role and access changes without leaking raw database messages',async()=>{
 const f=fixture({targetRole:'admin',rpcError:{code:'P0001',message:'last admin; password=private-secret; server-key'}});
 for(const [action,body]of [['change-role',{user_id:ids.target,role:'seller',store_id:ids.store}],['set-access',{user_id:ids.target,is_active:false}]]){
   const response=await f.api(request(action,body));assert.equal(response.status,400);assert.doesNotMatch(await response.text(),/password|private-secret|server-key|last admin/);
 }
 assert(!f.calls.some(c=>c[0]==='ban'));
});
test('last active administrator detail maps only the exact trusted marker to a friendly conflict',async()=>{
 const f=fixture({targetRole:'admin',rpcError:{code:'P0001',details:'LAST_ACTIVE_ADMIN',message:'private database data'}});
 for(const [action,body]of [['change-role',{user_id:ids.target,role:'seller',store_id:ids.store}],['set-access',{user_id:ids.target,is_active:false}]]){
   const response=await f.api(request(action,body));assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'Mantenha pelo menos um administrador ativo antes de rebaixar ou desativar esta conta.'});
 }
 assert(!f.calls.some(c=>c[0]==='ban'));
 const arbitrary=fixture({rpcError:{code:'P0001',details:'LAST_ACTIVE_ADMIN private suffix',message:'private data'}});const response=await arbitrary.api(request('change-role',{user_id:ids.target,role:'seller',store_id:ids.store}));assert.equal(response.status,400);assert.doesNotMatch(await response.text(),/private|LAST_ACTIVE_ADMIN/);
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
