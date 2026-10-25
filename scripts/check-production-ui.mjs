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
const makeToken=user=>['test',Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fixture'].join('.');
const profile={id:id(1),organization_id:id(100),store_id:id(110),name:'Gerente de teste',email:'manager@example.test',role:'manager',is_active:true,handle:'',coupon:''};
const seller={...profile,id:id(3),name:'Vendedor de teste',email:'seller@example.test',role:'seller',external_id:'S1'};
const accounts=[profile,seller];
const store={id:id(110),name:'Quiosque de teste'},agenda={id:id(120),name:'Relacionamento',kind:'manual'};
const snapshot={profile,stores:[store],profiles:[profile,seller],agendas:[agenda],totals:{gross:100,returns:0,orders:1,contacts_available:1,contacts_completed:0,conversion:null,previous_gross:80,attributed_gross:0},by_seller:[{seller_id:seller.id,name:seller.name,gross:100,returns:0,orders:1,contacts_available:1,contacts_completed:0,available_preferencial:1,completed_preferencial:0,completed_gotas:0}],by_agenda:[],by_store:[{store_id:store.id,name:store.name,gross:100,returns:0,orders:1}],by_day:[],targets:[],latest_sync:null};
let browser;
try{
  for(let n=0;n<100;n++){try{if((await fetch(baseUrl)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext(),page=await context.newPage({viewport:{width:1440,height:1000}}),errors=[],calls=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.routeWebSocket('wss://fixture-project.supabase.co/**',socket=>socket.close());
  await context.route(fixtureUrl+'/**',async route=>{
    const url=new URL(route.request().url()),body=route.request().postDataJSON();
    calls.push({path:url.pathname,search:url.search,body});
    let result;
    const bearer=route.request().headers().authorization?.split(' ')[1];let caller=profile;try{const sub=JSON.parse(Buffer.from(bearer.split('.')[1],'base64url')).sub;caller=accounts.find(p=>p.id===sub)||profile;}catch{}
    if(url.pathname==='/auth/v1/token'){const person=accounts.find(p=>p.email===body.email)||profile;result={access_token:makeToken(person),refresh_token:'test-refresh-token',expires_in:3600,token_type:'bearer',user:{id:person.id,email:person.email,aud:'authenticated',role:'authenticated',created_at:new Date().toISOString()}};}
    else if(url.pathname==='/auth/v1/user')result={id:caller.id,email:caller.email,aud:'authenticated',role:'authenticated'};
    else if(url.pathname==='/rest/v1/profiles')result=[accounts.find(p=>url.searchParams.get('id')==='eq.'+p.id)||caller];
    else if(url.pathname==='/rest/v1/stores')result=[store];
    else if(url.pathname==='/rest/v1/rpc/report_snapshot')result={...snapshot,profile:caller,profiles:caller.role==='seller'?[seller]:snapshot.profiles};
    else if(url.pathname==='/rest/v1/contact_tasks')result=[{id:id(140),status:'pending',due_date:new Date().toISOString().slice(0,10),customer:{name:'Cliente teste',phone:'5511999998888',do_not_contact:false},agenda:{name:agenda.name}}];
    else if(url.pathname==='/rest/v1/customers')result=[{id:id(130),name:'Cliente teste',phone:'5511999998888'}];
    else if(url.pathname==='/rest/v1/rpc/assign_contacts')result={assigned:1};
    else if(url.pathname==='/rest/v1/rpc/complete_contact')result={status:'completed'};
    else if(url.pathname==='/auth/v1/recover'||url.pathname==='/auth/v1/logout')result={};
    else return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({message:'Unexpected test route '+url.pathname})});
    await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(baseUrl);
  assert.equal(await page.getByRole('button',{name:'Entrar na demonstração'}).count(),0);
  await page.locator('[name="email"]').fill(profile.email);await page.locator('[name="password"]').fill('fixture-password-only');await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.locator('#production-greeting').waitFor();assert.match(await page.locator('main').innerText(),/R\$\s*100,00/);
  assert(calls.some(call=>call.path==='/auth/v1/token'));
  await page.locator('.workspace-trigger[data-action="menu"]').click();await page.locator('[data-action="nav:distribution"]').click();await page.locator('[name="quantity"]').fill('1');await page.locator('[name="sellers"]').check();await page.getByRole('button',{name:'Confirmar distribuição'}).click();await page.getByText('Distribuição concluída.',{exact:true}).waitFor();assert(calls.some(call=>call.path.endsWith('assign_contacts')&&call.body.p_quantity===1));
  await page.locator('.workspace-trigger[data-action="menu"]').click();await page.locator('[data-action="nav:agendas"]').click();await page.getByRole('button',{name:'Registrar atendimento',exact:true}).click();await page.locator('[name="outcome"]').selectOption('contacted');await page.getByRole('button',{name:'Confirmar',exact:true}).click();await page.getByText('Atendimento registrado.',{exact:true}).waitFor();assert(calls.some(call=>call.path.endsWith('complete_contact')&&call.body.p_outcome==='contacted'));
  const taskCall=calls.find(call=>call.path.endsWith('contact_tasks'));assert(taskCall.search.includes('due_date=gte.'));assert(taskCall.search.includes('due_date=lte.'));
  await page.locator('.workspace-trigger[data-action="menu"]').click();await page.locator('[data-action="nav:realtime"]').click();assert.match(await page.locator('.metrics').innerText(),/—/);
  for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  // Cross-tab account changes must clear the previous manager's identity and permissions.
  const second=await context.newPage();await second.goto(baseUrl);await second.locator('#production-greeting').waitFor();
  await second.locator('.workspace-trigger').click();await second.getByRole('button',{name:'Sair da conta',exact:true}).click();
  await page.getByRole('button',{name:'Entrar',exact:true}).waitFor();assert(!((await page.locator('body').innerText()).includes(profile.name)));
  await second.locator('[name="email"]').fill(seller.email);await second.locator('[name="password"]').fill('fixture-password-only');await second.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.locator('.workspace-trigger').filter({hasText:seller.name}).waitFor({timeout:5000}).catch(async problem=>{console.error('FIRST TAB',await page.locator('body').innerText(),'SECOND TAB',await second.locator('body').innerText());throw problem;});
  assert(!((await page.locator('body').innerText()).includes(profile.name)));assert.equal(await page.locator('[data-action="nav:imports"]').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS production UI: real auth flow (mocked service), no demo bypass, database snapshot, assignment/contact RPCs, date constraints, empty conversion, mobile layout and cross-tab account isolation. No remote project used.');
}finally{await browser?.close();server.kill();}
