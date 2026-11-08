import {chromium} from 'playwright';
import {spawnSync,spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import net from 'node:net';
const fixtureUrl='https://fixture-project.supabase.co';
const build=spawnSync('npm',['run','build','--','--outDir','/tmp/valance-ui-test-dist'],{env:{...process.env,VITE_APP_MODE:'production',VITE_SUPABASE_URL:fixtureUrl,VITE_SUPABASE_ANON_KEY:'sb_publishable_test_fixture_not_a_real_key'},encoding:'utf8'});
if(build.status!==0)throw new Error(build.stderr||build.stdout);
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const baseUrl=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort','--outDir','/tmp/valance-ui-test-dist'],{stdio:'ignore'});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const makeToken=(user,sessionId,time)=>['test',Buffer.from(JSON.stringify({sub:user.id,session_id:sessionId,role:'authenticated',aud:'authenticated',iat:Math.floor(time/1000),exp:Math.floor(time/1000)+3600})).toString('base64url'),'fixture'].join('.');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const profile={id:id(1),organization_id:id(100),store_id:id(110),name:'Gerente de teste',email:'manager@example.test',role:'manager',is_active:true,handle:'',coupon:''};
const seller={...profile,id:id(3),name:'Vendedor de teste',email:'seller@example.test',role:'seller',external_id:'S1'};
const admin={...profile,id:id(2),store_id:null,name:'Administrador de teste',email:'admin@example.test',role:'admin'};
const otherAdmin={...admin,id:id(4),name:'Wilber administrador de teste',email:'other-admin@example.test'};
const accounts=[profile,seller,admin,otherAdmin];
const store={id:id(110),name:'Quiosque de teste'},agenda={id:id(120),name:'Relacionamento',kind:'manual'};
const otherStore={id:id(111),name:'Outro quiosque de teste'};
const snapshot={profile,stores:[store],profiles:[profile,seller],agendas:[agenda],totals:{gross:100,returns:0,orders:1,contacts_available:1,contacts_completed:0,conversion:null,previous_gross:80,attributed_gross:0},by_seller:[{seller_id:seller.id,name:seller.name,gross:100,returns:0,orders:1,contacts_available:1,contacts_completed:0,available_preferencial:1,completed_preferencial:0,completed_gotas:0}],by_agenda:[],by_store:[{store_id:store.id,name:store.name,gross:100,returns:0,orders:1}],by_day:[],targets:[],latest_sync:null};
let browser;
try{
  for(let n=0;n<100;n++){try{if((await fetch(baseUrl)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext(),page=await context.newPage({viewport:{width:1440,height:1000}}),errors=[],calls=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.routeWebSocket('wss://fixture-project.supabase.co/**',socket=>socket.close());
  let rejectReportForStore=null,releaseInvitation,invitationStarted,nextInvitationHold=null,nextReportHold=null,nextSessionId=1000;
  const sessions=new Map(),refreshSessions=new Map();
  const visibleTeam=(caller,storeId)=>caller.role==='seller'?[caller]:accounts.filter(p=>p.id===caller.id||p.store_id===storeId&&p.role==='seller'||caller.role==='admin'&&(p.role==='admin'||p.store_id===storeId));
  const invitationInFlight=new Promise(resolve=>{invitationStarted=resolve;});
  const invitationResponse=new Promise(resolve=>{releaseInvitation=resolve;});
  const mockApi=async route=>{
    const url=new URL(route.request().url()),body=route.request().postDataJSON();
    calls.push({path:url.pathname,search:url.search,body});
    if(url.searchParams.get('action')==='invite-user'){
      if(nextInvitationHold){const hold=nextInvitationHold;nextInvitationHold=null;hold.started.resolve();await hold.release.promise;}
      invitationStarted();await invitationResponse;
      return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({user_id:id(8),status:'invited'})});
    }
    if(url.searchParams.get('action')==='import-presence')return route.fulfill({contentType:'application/json',body:JSON.stringify({result:{customers:1}})});
    if(url.searchParams.get('action')==='reset-user')return route.fulfill({contentType:'application/json',body:JSON.stringify({status:'recovery_sent'})});
    if(['update-user','change-role'].includes(url.searchParams.get('action'))){
      const person=accounts.find(p=>p.id===body.user_id);assert(person,'fixture target exists');
      if(url.searchParams.get('action')==='change-role')Object.assign(person,{role:body.role,store_id:body.store_id});
      else for(const key of ['name','handle','coupon','external_id'])if(key in body)person[key]=body[key];
      return route.fulfill({contentType:'application/json',body:JSON.stringify({result:person})});
    }
    return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Unexpected API action'})});
  };
  const mockSupabase=async route=>{
    const url=new URL(route.request().url()),body=route.request().postDataJSON();
    const time=await route.request().frame().evaluate(()=>Date.now());
    const call={path:url.pathname,search:url.search,body,time};calls.push(call);
    let result;
    const bearer=route.request().headers().authorization?.split(' ')[1];let caller=profile,sessionId;try{const claims=JSON.parse(Buffer.from(bearer.split('.')[1],'base64url'));caller=accounts.find(p=>p.id===claims.sub)||profile;sessionId=claims.session_id;}catch{}
    call.sessionId=sessionId;
    const expired=()=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'P0001',details:'APP_SESSION_EXPIRED',message:'Sessão encerrada por inatividade. Entre novamente.'})});
    const current=sessions.get(sessionId);
    if(url.pathname.startsWith('/rest/v1/')&&!url.pathname.endsWith('/touch_app_session')&&!url.pathname.endsWith('/end_app_session')&&(!current||current.ended||time>=current.lastActivity+3600000))return expired();
    if(url.pathname==='/auth/v1/token'){
      const previous=url.searchParams.get('grant_type')==='refresh_token'?refreshSessions.get(body.refresh_token):null;
      const person=previous?.person||accounts.find(p=>p.email===body.email)||profile;
      const sid=previous?.sessionId||id(nextSessionId++),refreshToken=`fixture-refresh-${sid}`;
      refreshSessions.set(refreshToken,{person,sessionId:sid});call.sessionId=sid;
      result={access_token:makeToken(person,sid,time),refresh_token:refreshToken,expires_in:3600,token_type:'bearer',user:{id:person.id,email:person.email,aud:'authenticated',role:'authenticated',created_at:new Date(time).toISOString()}};
    }
    else if(url.pathname==='/auth/v1/user')result={id:caller.id,email:caller.email,aud:'authenticated',role:'authenticated'};
    else if(url.pathname==='/rest/v1/rpc/touch_app_session'){
      assert(sessionId,'session touches use the authenticated JWT session ID');
      const record=current||{profileId:caller.id,lastActivity:time,ended:false};
      if(record.ended||time>=record.lastActivity+3600000)return expired();
      if(body.p_active)record.lastActivity=time;record.lastSeen=time;sessions.set(sessionId,record);
      result={last_seen_at:new Date(time).toISOString(),last_activity_at:new Date(record.lastActivity).toISOString(),expires_at:new Date(record.lastActivity+3600000).toISOString()};
    }
    else if(url.pathname==='/rest/v1/rpc/end_app_session'){
      assert(sessionId,'session endings use the authenticated JWT session ID');
      sessions.set(sessionId,{...current,profileId:caller.id,lastActivity:current?.lastActivity??time,ended:true});result=null;
    }
    else if(url.pathname==='/rest/v1/rpc/team_presence')result=visibleTeam(caller,body.p_store_id||caller.store_id||store.id).map(person=>({profile_id:person.id,is_online:person.id===otherAdmin.id||person.id===caller.id}));
    else if(url.pathname==='/rest/v1/profiles')result=[accounts.find(p=>url.searchParams.get('id')==='eq.'+p.id)||caller];
    else if(url.pathname==='/rest/v1/stores')result=caller.role==='admin'?[store,otherStore]:[store,otherStore].filter(row=>row.id===caller.store_id);
    else if(url.pathname==='/rest/v1/rpc/report_snapshot'){
      if(rejectReportForStore&&body.p_store_id===rejectReportForStore){rejectReportForStore=null;return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Período inválido (máximo 10 anos)'})});}
      const scopedStore=[store,otherStore].find(row=>row.id===(body.p_store_id||caller.store_id))||store;
      const visible=visibleTeam(caller,scopedStore.id);
      result={...snapshot,profile:caller,stores:caller.role==='admin'?[store,otherStore]:[scopedStore],profiles:visible,totals:{...snapshot.totals,gross:caller.role==='admin'?9009:100}};
      if(nextReportHold?.userId===caller.id){const hold=nextReportHold;nextReportHold=null;const captured=JSON.stringify(result);hold.started.resolve();await hold.release.promise;return route.fulfill({contentType:'application/json',body:captured});}
    }
    else if(url.pathname==='/rest/v1/contact_tasks')result=[{id:id(140),status:'pending',due_date:new Date().toISOString().slice(0,10),customer:{name:'Cliente teste',phone:'5511999998888',do_not_contact:false},agenda:{name:agenda.name}}];
    else if(url.pathname==='/rest/v1/customers')result=[{id:id(130),name:caller.role==='admin'?'Cliente administrativo confidencial':'Cliente teste',phone:'5511999998888'}];
    else if(url.pathname==='/rest/v1/rpc/assign_contacts')result={assigned:1};
    else if(url.pathname==='/rest/v1/rpc/complete_contact')result={status:'completed'};
    else if(url.pathname==='/auth/v1/recover'||url.pathname==='/auth/v1/logout')result={};
    else return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({message:'Unexpected test route '+url.pathname})});
    await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  };
  await context.route(fixtureUrl+'/**',mockSupabase);
  await context.route(baseUrl+'/.netlify/functions/api**',mockApi);
  await page.goto(baseUrl);
  assert.equal(await page.getByRole('button',{name:'Entrar na demonstração'}).count(),0);
  await page.locator('[name="email"]').fill(profile.email);await page.locator('[name="password"]').fill('fixture-password-only');await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.locator('#production-greeting').waitFor();assert.match(await page.locator('main').innerText(),/R\$\s*100,00/);
  assert(calls.some(call=>call.path==='/auth/v1/token'));
  assert(calls.findIndex(call=>call.path.endsWith('/touch_app_session'))<calls.findIndex(call=>call.path==='/rest/v1/profiles'),'session ledger is bootstrapped before profile RLS reads');
  assert.equal(calls.find(call=>call.path.endsWith('/touch_app_session')).body.p_active,false,'initialization is passive');
  await page.locator('.workspace-trigger[data-action="menu"]').click();await page.locator('[data-action="nav:distribution"]').click();await page.locator('[name="quantity"]').fill('1');await page.locator('[name="sellers"]').check();await page.getByRole('button',{name:'Confirmar distribuição'}).click();await page.getByText('Distribuição concluída.',{exact:true}).waitFor();assert(calls.some(call=>call.path.endsWith('assign_contacts')&&call.body.p_quantity===1));
  await page.locator('.workspace-trigger[data-action="menu"]').click();await page.locator('[data-action="nav:agendas"]').click();await page.getByRole('button',{name:'Registrar atendimento',exact:true}).click();await page.locator('[name="outcome"]').selectOption('contacted');await page.getByRole('button',{name:'Confirmar',exact:true}).click();await page.getByText('Atendimento registrado.',{exact:true}).waitFor();assert(calls.some(call=>call.path.endsWith('complete_contact')&&call.body.p_outcome==='contacted'));
  const taskCall=calls.find(call=>call.path.endsWith('contact_tasks'));assert(taskCall.search.includes('due_date=gte.'));assert(taskCall.search.includes('due_date=lte.'));
  await page.locator('.workspace-trigger[data-action="menu"]').click();await page.locator('[data-action="nav:realtime"]').click();assert.match(await page.locator('.metrics').innerText(),/—/);
  for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  // A confirmed invitation returning after a cross-tab account change must never
  // show the previous account's employee details in the new session.
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.workspace-trigger[data-action="menu"]').click();await page.locator('[data-action="nav:users"]').click();
  await page.getByRole('button',{name:'Convidar funcionário',exact:true}).click();
  const privateInvite={name:'Funcionário privado da sessão anterior',email:'private-invite@example.test'};
  await page.locator('#invite-form [name="name"]').fill(privateInvite.name);await page.locator('#invite-form [name="email"]').fill(privateInvite.email);
  await page.locator('#invite-form [type="submit"]').click();await invitationInFlight;
  // Cross-tab account changes must also clear the previous identity/permissions.
  const second=await context.newPage();await second.goto(baseUrl);await second.locator('#production-greeting').waitFor();
  await second.locator('.workspace-trigger').click();await second.getByRole('button',{name:'Sair da conta',exact:true}).click();
  await page.getByRole('button',{name:'Entrar',exact:true}).waitFor();assert(!((await page.locator('body').innerText()).includes(profile.name)));
  await second.locator('[name="email"]').fill(seller.email);await second.locator('[name="password"]').fill('fixture-password-only');await second.getByRole('button',{name:'Entrar',exact:true}).click();
  await second.locator('#production-greeting').waitFor();await page.bringToFront();
  await page.locator('.workspace-trigger').filter({hasText:seller.name}).waitFor({timeout:10000}).catch(async problem=>{console.error('FIRST TAB',await page.locator('body').innerText(),'SECOND TAB',await second.locator('body').innerText());throw problem;});
  assert(!((await page.locator('body').innerText()).includes(profile.name)));assert.equal(await page.locator('[data-action="nav:imports"]').count(),0);
  const invitationFinished=page.waitForResponse(response=>response.url().includes('/.netlify/functions/api?action=invite-user'));
  releaseInvitation();await (await invitationFinished).finished();
  // Let fetch/json continuations finish before checking the absence of the old
  // sharing dialog; the network response deliberately completed after login B.
  await page.waitForTimeout(100);
  const afterInvitation=await page.locator('body').innerText();
  assert(!afterInvitation.includes(privateInvite.name));assert(!afterInvitation.includes(privateInvite.email));
  assert.equal(await page.locator('#production-share-text').count(),0);
  assert.match(await page.locator('.workspace-trigger').innerText(),new RegExp(seller.name));
  assert.equal(calls.filter(call=>call.search==='?action=invite-user').length,1,'session changes do not retry an already confirmed invitation');

  // A rejected store filter must restore both the visible store and the store
  // used by the following mutation, rather than import into the rejected store.
  const adminContext=await browser.newContext(),adminPage=await adminContext.newPage({viewport:{width:1440,height:1000}});
  adminPage.on('pageerror',error=>errors.push(error.message));
  await adminContext.routeWebSocket('wss://fixture-project.supabase.co/**',socket=>socket.close());
  await adminContext.route(fixtureUrl+'/**',mockSupabase);await adminContext.route(baseUrl+'/.netlify/functions/api**',mockApi);
  await adminPage.goto(baseUrl);await adminPage.locator('[name="email"]').fill(admin.email);await adminPage.locator('[name="password"]').fill('fixture-password-only');await adminPage.getByRole('button',{name:'Entrar',exact:true}).click();await adminPage.locator('#production-greeting').waitFor();
  // Organization administrators remain visible in team management even though
  // their profiles have no store. Authorized admins can now edit/reset peers.
  await adminPage.locator('.workspace-trigger').click();await adminPage.locator('.sidebar [data-action="nav:users"]').click();
  await adminPage.getByRole('heading',{name:'Equipe do quiosque e administradores',exact:true}).waitFor();
  const ownAdminRow=adminPage.getByRole('row').filter({has:adminPage.getByRole('cell',{name:admin.email,exact:true})});
  const otherAdminRow=adminPage.getByRole('row').filter({has:adminPage.getByRole('cell',{name:otherAdmin.email,exact:true})});
  assert.equal(await ownAdminRow.count(),1);assert.equal(await otherAdminRow.count(),1);
  assert.equal(await adminPage.getByRole('cell',{name:'Administrador',exact:true}).count(),2);
  assert.match(await otherAdminRow.innerText(),new RegExp(otherAdmin.name));
  await otherAdminRow.locator(`[data-presence-profile="${otherAdmin.id}"].online`).waitFor();
  await adminPage.getByRole('row').filter({has:adminPage.getByRole('cell',{name:seller.email,exact:true})}).locator(`[data-presence-profile="${seller.id}"].offline`).waitFor();
  for(const [person,state] of [[otherAdmin,'Online'],[seller,'Offline']]){
    const dot=adminPage.getByRole('row').filter({has:adminPage.getByRole('cell',{name:person.email,exact:true})}).locator(`[data-presence-profile="${person.id}"]`);
    assert(await dot.getAttribute('title'),'presence dots expose an explanatory tooltip');assert.equal(await dot.getAttribute('aria-label'),state);
    assert.equal(await dot.evaluate(node=>getComputedStyle(node).backgroundColor),state==='Online'?'rgb(119, 207, 98)':'rgb(113, 133, 138)','presence renders green online and gray offline');
  }
  for(const name of ['Editar','Alterar função','Desativar','Recuperar senha'])assert.equal(await otherAdminRow.getByRole('button',{name,exact:true}).count(),1,`another administrator supports ${name}`);
  for(const name of ['Editar','Recuperar senha'])assert.equal(await ownAdminRow.getByRole('button',{name,exact:true}).count(),1,`own administrator preserves ${name}`);
  assert.equal(await ownAdminRow.getByRole('button',{name:'Desativar',exact:true}).count(),0);
  for(const person of [profile,seller]){
    const row=adminPage.getByRole('row').filter({has:adminPage.getByRole('cell',{name:person.email,exact:true})});assert.equal(await row.count(),1);
    for(const name of ['Editar','Desativar','Recuperar senha'])assert.equal(await row.getByRole('button',{name,exact:true}).count(),1,`operational ${person.role} preserves ${name}`);
  }
  await otherAdminRow.getByRole('button',{name:'Editar',exact:true}).click();
  await adminPage.locator('#edit-form [name="name"]').fill('Wilber administrador atualizado');await adminPage.locator('#edit-form [type="submit"]').click();await adminPage.getByText('Funcionário atualizado.',{exact:true}).waitFor();
  assert(calls.some(call=>call.search==='?action=update-user'&&call.body.user_id===otherAdmin.id&&call.body.name==='Wilber administrador atualizado'));
  await otherAdminRow.getByRole('button',{name:'Recuperar senha',exact:true}).click();await adminPage.getByText('Solicitação de recuperação enviada. Nenhuma senha é compartilhada.',{exact:true}).waitFor();
  assert(calls.some(call=>call.search==='?action=reset-user'&&call.body.user_id===otherAdmin.id));
  const changeRole=async(person,role,storeId)=>{
    const row=adminPage.getByRole('row').filter({has:adminPage.getByRole('cell',{name:person.email,exact:true})});
    await row.getByRole('button',{name:'Alterar função',exact:true}).click();await adminPage.locator('#role-form [name="role"]').selectOption(role);
    if(role!=='admin')await adminPage.locator('#role-form [name="store_id"]').selectOption(storeId);
    else assert.equal(await adminPage.locator('#role-form [name="store_id"]').isDisabled(),true);
    await adminPage.locator('#role-form [name="confirm"]').check();await adminPage.locator('#role-form [type="submit"]').click();
  };
  for(const role of ['admin','manager','seller']){
    await changeRole(seller,role,store.id);await adminPage.getByText('Função e permissões atualizadas.',{exact:true}).waitFor();
    assert(calls.some(call=>call.search==='?action=change-role'&&call.body.user_id===seller.id&&call.body.role===role&&call.body.store_id===(role==='admin'?null:store.id)));
  }
  await adminPage.getByRole('button',{name:'Convidar funcionário',exact:true}).click();await adminPage.locator('#invite-form [name="name"]').fill('Administrador convidado de teste');await adminPage.locator('#invite-form [name="email"]').fill('invited-admin@example.test');await adminPage.locator('#invite-form [name="role"]').selectOption('admin');
  assert.equal(await adminPage.locator('#invite-form [name="store_id"]').isDisabled(),true);
  await adminPage.locator('#invite-form [type="submit"]').click();await adminPage.locator('#production-share-text').waitFor();
  assert(calls.some(call=>call.search==='?action=invite-user'&&call.body.role==='admin'&&call.body.store_id===null));
  await adminPage.locator('[data-action="close"]').click();
  await adminPage.locator('.workspace-trigger').click();await adminPage.locator('.sidebar [data-action="nav:imports"]').click();
  const previousFrom=await adminPage.locator('#production-filters [name="from"]').inputValue();
  rejectReportForStore=otherStore.id;
  await adminPage.locator('#production-filters [name="store"]').selectOption(otherStore.id);await adminPage.locator('#production-filters [name="from"]').fill('1900-01-01');
  await adminPage.getByRole('button',{name:'Filtrar',exact:true}).click();await adminPage.locator('#production-error').filter({hasText:'Período inválido'}).waitFor();
  assert.equal(await adminPage.locator('#production-filters [name="store"]').inputValue(),store.id);
  assert.equal(await adminPage.locator('#production-filters [name="from"]').inputValue(),previousFrom);
  await adminPage.getByRole('button',{name:'Validar e importar para '+store.name,exact:true}).waitFor();
  await adminPage.locator('#production-import [name="file"]').setInputFiles({name:'clientes.csv',mimeType:'text/csv',buffer:Buffer.from('external_id;name\nC-REGRESSION;Cliente de regressão\n')});
  await adminPage.getByRole('button',{name:'Validar e importar para '+store.name,exact:true}).click();await adminPage.getByText('Importação confirmada. Os usuários conectados receberão a atualização.',{exact:true}).waitFor();
  assert.equal(calls.findLast(call=>call.search==='?action=import-presence').body.store_id,store.id);
  assert(calls.some(call=>call.path.endsWith('report_snapshot')&&call.body.p_store_id===otherStore.id&&call.body.p_from==='1900-01-01'));

  // Self-demotion must reload authorization, remove admin data/actions and use
  // the newly assigned store without requiring another login or a fresh JWT.
  await adminPage.locator('.workspace-trigger').click();await adminPage.locator('.sidebar [data-action="nav:users"]').click();
  await changeRole(admin,'manager',otherStore.id);await adminPage.getByText('Sua função foi atualizada.',{exact:true}).waitFor();
  assert.equal(await adminPage.locator('[data-action^="role:"]').count(),0);
  assert.equal(await adminPage.locator('#production-filters [name="store"]').inputValue(),otherStore.id);
  assert(!((await adminPage.locator('body').innerText()).includes(otherAdmin.email)));
  assert(!((await adminPage.locator('main').innerText()).includes('9.009,00')));

  // Another administrator promotes this same account. A visibility recheck
  // represents returning to the tab after that external permission update.
  Object.assign(admin,{role:'admin',store_id:null});await adminPage.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await adminPage.waitForFunction(()=>document.querySelector('footer')?.textContent.includes('admin'));
  await adminPage.locator('.workspace-trigger').click();await adminPage.locator('.sidebar [data-action="nav:customers"]').click();
  await adminPage.locator('[name="query"]').fill('Busca privada anterior');await adminPage.getByRole('button',{name:'Buscar',exact:true}).click();
  await adminPage.locator('.workspace-trigger').click();await adminPage.locator('.sidebar [data-action="nav:users"]').click();
  const heldReport={userId:admin.id,started:deferred(),release:deferred()},heldInvite={started:deferred(),release:deferred()};nextReportHold=heldReport;nextInvitationHold=heldInvite;
  // Start a second report request while the existing team DOM is still shown.
  await adminPage.evaluate(()=>document.querySelector('.sidebar [data-action="nav:users"]').click());await heldReport.started.promise;
  await adminPage.getByRole('button',{name:'Convidar funcionário',exact:true}).click({force:true});
  const previousRoleInvite={name:'Funcionário da autorização antiga',email:'previous-role@example.test'};
  await adminPage.locator('#invite-form [name="name"]').fill(previousRoleInvite.name);await adminPage.locator('#invite-form [name="email"]').fill(previousRoleInvite.email);await adminPage.locator('#invite-form [type="submit"]').click();await heldInvite.started.promise;
  Object.assign(admin,{role:'seller',store_id:otherStore.id});await adminPage.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await adminPage.waitForFunction(()=>document.querySelector('footer')?.textContent.includes('seller'));
  assert.equal(await adminPage.locator('[data-action="nav:users"]').count(),0);assert.equal(await adminPage.locator('[data-action="nav:imports"]').count(),0);assert.equal(await adminPage.locator('#modal-root .modal').count(),0);
  const oldReportFinished=adminPage.waitForResponse(response=>response.url().includes('/rpc/report_snapshot')&&response.request().postDataJSON().p_store_id===store.id);
  const oldInviteFinished=adminPage.waitForResponse(response=>response.url().includes('/.netlify/functions/api?action=invite-user'));
  heldReport.release.resolve();heldInvite.release.resolve();await Promise.all([(await oldReportFinished).finished(),(await oldInviteFinished).finished()]);await adminPage.waitForTimeout(100);
  const reducedBody=await adminPage.locator('body').innerText();
  for(const privateValue of [otherAdmin.email,previousRoleInvite.name,previousRoleInvite.email,'9.009,00'])assert(!reducedBody.includes(privateValue),`reduced authorization cannot show ${privateValue}`);
  assert.equal(await adminPage.locator('#production-share-text').count(),0);assert.equal(await adminPage.locator('[data-action^="role:"]').count(),0);
  await adminPage.locator('.workspace-trigger').click();await adminPage.locator('.sidebar [data-action="nav:customers"]').click();assert.equal(await adminPage.locator('[name="query"]').inputValue(),'','permission reset clears private search text');
  await adminContext.close();

  const idleStart=Date.now();
  async function clockLogin(time=idleStart){
    const clockContext=await browser.newContext();
    await clockContext.routeWebSocket('wss://fixture-project.supabase.co/**',socket=>socket.close());
    await clockContext.route(fixtureUrl+'/**',mockSupabase);await clockContext.route(baseUrl+'/.netlify/functions/api**',mockApi);
    const clockPage=await clockContext.newPage();clockPage.on('pageerror',error=>errors.push(error.message));
    await clockPage.clock.install({time:new Date(time)});await clockPage.goto(baseUrl);
    await clockPage.locator('[name="email"]').fill(profile.email);await clockPage.locator('[name="password"]').fill('fixture-password-only');await clockPage.getByRole('button',{name:'Entrar',exact:true}).click();
    await clockPage.locator('#production-greeting').waitFor();
    const sessionId=calls.findLast(call=>call.path==='/auth/v1/token'&&call.search.includes('grant_type=password')).sessionId;
    return {clockContext,clockPage,sessionId};
  }
  // Passive heartbeats, the visible clock and an actual token refresh preserve
  // the original inactivity deadline. Another browser keeps its own session.
  {
    const {clockContext,clockPage,sessionId}=await clockLogin();
    const refreshed=clockPage.waitForResponse(response=>response.url().includes('/auth/v1/token?grant_type=refresh_token'));
    const passiveHeartbeat=clockPage.waitForResponse(response=>response.url().endsWith('/rpc/touch_app_session')&&response.request().postDataJSON().p_active===false);
    await clockPage.clock.fastForward(59*60000);await Promise.all([(await refreshed).finished(),(await passiveHeartbeat).finished()]);
    assert.equal(calls.findLast(call=>call.path==='/auth/v1/token'&&call.search.includes('refresh_token')).sessionId,sessionId,'refresh preserves the signed session ID');
    assert(calls.some(call=>call.path.endsWith('/touch_app_session')&&call.sessionId===sessionId&&!call.body.p_active&&call.time>=idleStart+58*60000),'idle heartbeat remains passive');
    assert.equal(calls.some(call=>call.path.endsWith('/touch_app_session')&&call.sessionId===sessionId&&call.body.p_active),false,'passive clock and refresh never count as input');
    const loggedOut=clockPage.waitForResponse(response=>response.url().includes('/auth/v1/logout'));
    await clockPage.clock.fastForward(61000);await clockPage.getByRole('button',{name:'Entrar',exact:true}).waitFor();await (await loggedOut).finished();
    assert.equal(await clockPage.locator('#production-greeting').count(),0);
    assert(calls.some(call=>call.path.endsWith('/end_app_session')&&call.sessionId===sessionId));
    assert(calls.some(call=>call.path==='/auth/v1/logout'&&call.sessionId===sessionId&&call.search==='?scope=local'),'idle logout is local to this browser session');
    assert.equal(await second.locator('#production-greeting').count(),1,'another browser session remains signed in');
    await clockPage.locator('[name="email"]').fill(profile.email);await clockPage.locator('[name="password"]').fill('fixture-password-only');await clockPage.getByRole('button',{name:'Entrar',exact:true}).click();
    await clockPage.locator('#production-greeting').waitFor();
    assert.notEqual(calls.findLast(call=>call.path==='/auth/v1/token'&&call.search.includes('grant_type=password')).sessionId,sessionId,'fresh login receives a new identity after expiry');
    await clockContext.close();
  }
  // Reloading at minute 40 must retain the deadline from the original login.
  {
    const {clockContext,clockPage,sessionId}=await clockLogin(idleStart+10000);
    await clockPage.clock.fastForward(40*60000);await clockPage.reload();await clockPage.locator('#production-greeting').waitFor();
    await clockPage.clock.fastForward(21*60000);await clockPage.getByRole('button',{name:'Entrar',exact:true}).waitFor();
    assert.equal(calls.filter(call=>call.path==='/auth/v1/token'&&call.sessionId===sessionId&&call.search.includes('grant_type=password')).length,1,'reload restores the same auth session');
    await clockContext.close();
  }
  // A real input in a second tab extends the shared deadline for both tabs.
  {
    const {clockContext,clockPage,sessionId}=await clockLogin(idleStart+20000);
    const activeTab=await clockContext.newPage();activeTab.on('pageerror',error=>errors.push(error.message));
    await activeTab.goto(baseUrl);await activeTab.locator('#production-greeting').waitFor();
    // Playwright's clock is shared by the pages in this browser context.
    await clockPage.clock.fastForward(50*60000);
    const activeTouch=activeTab.waitForResponse(response=>response.url().endsWith('/rpc/touch_app_session')&&response.request().postDataJSON().p_active===true);
    await activeTab.locator('.workspace-trigger').click();await (await activeTouch).finished();
    await clockPage.clock.fastForward(20*60000);
    assert.equal(await clockPage.locator('#production-greeting').count(),1,'activity in another tab prevents the original one-hour logout');
    assert.equal(calls.some(call=>call.path.endsWith('/end_app_session')&&call.sessionId===sessionId),false);
    await clockContext.close();
  }
  // Simulate a suspended computer: advancing wall time does not run timers.
  // The first trusted pointer event must check expiry before counting activity.
  {
    const {clockContext,clockPage,sessionId}=await clockLogin(idleStart+30000);
    const activeBefore=calls.filter(call=>call.path.endsWith('/touch_app_session')&&call.sessionId===sessionId&&call.body.p_active).length;
    const wakeTime=(await clockPage.evaluate(()=>Date.now()))+61*60000;await clockPage.clock.setSystemTime(new Date(wakeTime));
    await clockPage.mouse.click(5,5);await clockPage.getByRole('button',{name:'Entrar',exact:true}).waitFor();
    assert.equal(calls.filter(call=>call.path.endsWith('/touch_app_session')&&call.sessionId===sessionId&&call.body.p_active).length,activeBefore,'wake input cannot revive an expired session');
    await clockContext.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS production UI: auth/RPC flows, mobile layout, stale account/role responses, peer administration, accessible online/offline presence, passive refresh expiry, reload persistence, cross-tab activity and wake expiry. No remote project used.');
}finally{await browser?.close();server.kill();}
