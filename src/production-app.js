import {createClient} from '@supabase/supabase-js';
import {createIcons,Menu,X,Search,MessageCircle,Clock3,ArrowUpRight,CalendarDays,Users,Store,Target,Download,Check,LogOut,RefreshCw} from 'lucide';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/manrope/700.css';
import './style.css';
import './production.css';
import {greetingForHour,normalizePhone} from './header-tools.js';
import {csvText,workbookBytes,downloadFile} from './export.js';
import {parseImportCSV,importHeaders} from './import-csv.js';
import {reportTableData,renderReportPage} from './production-reports.js';
import './production-reports.css';
import {staffShareText,invitationShareText,agendaDayMessage} from './production-sharing.js';
const icons={Menu,X,Search,MessageCircle,Clock3,ArrowUpRight,CalendarDays,Users,Store,Target,Download,Check,LogOut,RefreshCw};
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<i data-lucide="${name}"></i>`;
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct=(n,d)=>Number(d)?(Number(n)/Number(d)*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—';
const number=n=>Number(n||0).toLocaleString('pt-BR',{maximumFractionDigits:2});
const $=selector=>document.querySelector(selector);
const table=(headers,rows)=>`<div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length?'':'<div class="empty">Nenhum registro para esta consulta.</div>'}`;
const field=(name,label,type='text',value='',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;
const button=(label,action,cls='')=>`<button class="btn ${cls}" data-action="${action}" type="button">${label}</button>`;
const option=(value,label,selected)=>`<option value="${e(value)}" ${value===selected?'selected':''}>${e(label)}</option>`;
const metric=(label,value,description='')=>`<article class="card metric"><div class="metric-label">${label}</div><strong>${value}</strong><p>${description}</p></article>`;
class SessionChanged extends Error {constructor(){super('A sessão foi alterada.');}}
const roleLabels={admin:'Administrador',manager:'Gerente',seller:'Vendedor'};
const names={overview:'Visão geral',agendas:'Agendas do dia',distribution:'Distribuir contatos',customers:'Clientes',sales:'Painel de vendas',generated:'Gerou por agenda','by-store':'Gerou por loja',realtime:'Real Time',performance:'Dedo Duro',store:'Painel da loja',users:'Vendedores',imports:'Importar dados',profile:'Meu perfil'};
export async function startProduction(config){
  let needsPassword=new URLSearchParams(location.search).has('auth')||/[#&]type=(recovery|invite)/.test(location.hash);
  const client=createClient(config.url,config.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  let auth=null,profile=null,stores=[],staff=[],agendas=[],snapshot=null,tasks=[],customers=[],selectedStore='',route='overview',query='',taskPage=0;
  let busy=false,initializing=false,accessLoading=false,refreshVersion=0,drawer=false,channel=null,realtime='Conectando',modal='',error='',lastFocus=null;
  let debounce,authGeneration=0,agendaDay={total:null,pending:null};
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let to=today(),from=to.slice(0,8)+'01',sellerFilter='',agendaFilter='',minimum=0;
  const isManager=()=>['admin','manager'].includes(profile?.role);
  const authorizationChanged=next=>!next||!next.is_active||next.role!==profile?.role||next.store_id!==profile?.store_id;
  function clearWorkspace(loading=false){
    authGeneration++;refreshVersion++;clearTimeout(debounce);
    profile=null;snapshot=null;tasks=[];customers=[];staff=[];stores=[];agendas=[];
    selectedStore='';sellerFilter='';agendaFilter='';minimum=0;taskPage=0;query='';error='';route='overview';modal='';drawer=false;
    agendaDay={total:null,pending:null};accessLoading=loading;
    if(channel){client.removeChannel(channel);channel=null;}
  }
  async function reloadAuthorization(){clearWorkspace(true);render();await initialize();}

  const notify=message=>{const n=$('#production-notice');if(n){n.textContent=message;n.hidden=false;}};
  const showError=problem=>{if(problem instanceof SessionChanged)return;error=problem?.message||'Não foi possível concluir a operação.';if($('#production-error'))$('#production-error').textContent=error;else render();};
  async function rpc(name,args){const generation=authGeneration;const result=await client.rpc(name,args);if(generation!==authGeneration)throw new SessionChanged();if(result.error)throw new Error(result.error.message||'Falha ao acessar o banco.');return result.data;}
  async function api(action,body){const generation=authGeneration,actorId=auth?.user?.id;const session=await client.auth.getSession();if(generation!==authGeneration||session.data.session?.user?.id!==actorId)throw new SessionChanged();if(!session.data.session)throw new Error('Sua sessão expirou. Entre novamente.');const response=await fetch(`/.netlify/functions/api?action=${encodeURIComponent(action)}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${session.data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});let data;try{data=await response.json();}catch{throw new Error('As funções do Netlify não responderam. Verifique a publicação do backend.');}if(generation!==authGeneration)throw new SessionChanged();if(!response.ok){const problem=new Error(data.error||'Operação não autorizada.');problem.code=data.code;problem.userId=data.user_id;if(problem.code==='PROFILE_PROVISIONING_PENDING'&&problem.userId)problem.message+=` Identificador para concluir o cadastro: ${problem.userId}.`;throw problem;}return data;}
  function reportContext(){return {...snapshot,filters:{store_id:selectedStore,seller_id:sellerFilter||null,agenda_id:agendaFilter||null}};}
  function currentRows(){return reportTableData(route,reportContext());}
  async function refresh(){
    if(!profile)return;const version=++refreshVersion,generation=authGeneration,profileId=profile.id;
    const taskQuery=client.from('contact_tasks').select('*,customer:customers(name,phone,do_not_contact),agenda:agendas(name)').gte('due_date',from).lte('due_date',to).order('due_date',{ascending:false}).order('id').range(taskPage*50,taskPage*50+49);
    if(selectedStore)taskQuery.eq('store_id',selectedStore);if(sellerFilter)taskQuery.eq('assigned_to',sellerFilter);if(agendaFilter)taskQuery.eq('agenda_id',agendaFilter);
    let customerQuery=client.from('customers').select('*').order('name').limit(50);if(selectedStore)customerQuery=customerQuery.eq('store_id',selectedStore);if(query)customerQuery=customerQuery.ilike('name',`%${query.replace(/[%_\\]/g,'')}%`);
    const dailyQueries=[false,true].map(pending=>{const q=client.from('contact_tasks').select('id',{count:'exact',head:true}).eq('due_date',today());if(pending)q.eq('status','pending');if(selectedStore)q.eq('store_id',selectedStore);if(sellerFilter)q.eq('assigned_to',sellerFilter);if(agendaFilter)q.eq('agenda_id',agendaFilter);return q;});
    let results;
    try{results=await Promise.all([rpc('report_snapshot',{p_store_id:selectedStore||null,p_from:from,p_to:to,p_seller_id:sellerFilter||null,p_agenda_id:agendaFilter||null,p_minimum:minimum}),taskQuery,customerQuery,...dailyQueries]);}
    catch(problem){if(generation===authGeneration&&profile?.id===profileId)await verifyAccess(true);if(generation!==authGeneration)throw new SessionChanged();throw problem;}
    if(generation!==authGeneration||profile?.id!==profileId)throw new SessionChanged();if(version!==refreshVersion)return;
    if(authorizationChanged(results[0]?.profile)){await reloadAuthorization();throw new SessionChanged();}
    for(const result of results.slice(1))if(result.error)throw new Error('Não foi possível carregar os contatos.');
    profile=results[0].profile;snapshot=results[0];tasks=results[1].data||[];customers=results[2].data||[];agendaDay={total:results[3].count??null,pending:results[4].count??null};staff=snapshot.profiles||[];agendas=snapshot.agendas||[];
  }
  function scheduleRefresh(){clearTimeout(debounce);debounce=setTimeout(async()=>{if(busy){scheduleRefresh();return;}try{await refresh();if(!modal)render();}catch(problem){showError(problem);}},500);}
  function subscribe(){
    if(channel)client.removeChannel(channel);
    realtime='Conectando';channel=client.channel(`workspace-${profile.id}-${selectedStore||'all'}`,{config:{postgres_changes_options:{wait:true}}});
    for(const table of ['customers','sales','contact_tasks','profiles','sales_targets','agendas','sync_runs'])channel.on('postgres_changes',{event:'*',schema:'public',table},event=>{if(table==='profiles'&&(event.new?.id===profile?.id||event.old?.id===profile?.id))verifyAccess(true).then(()=>scheduleRefresh()).catch(showError);else scheduleRefresh();});
    channel.subscribe(status=>{realtime=status==='SUBSCRIBED'?'Online':status==='CHANNEL_ERROR'?'Reconectando':'Conectando';const n=$('#realtime-state');if(n)n.textContent=realtime;});
  }
  async function initialize(){
    if(initializing)return;initializing=true;const generation=authGeneration;
    try{
      const result=await client.auth.getSession();if(generation!==authGeneration)return;auth=result.data.session;
      if(!auth){accessLoading=false;profile=null;render();return;}
      if(needsPassword){accessLoading=false;render();return;}
      const verified=await client.auth.getUser();if(generation!==authGeneration)return;if(verified.error||!verified.data?.user)throw new Error('Sessão inválida. Entre novamente.');
      const access=await client.from('profiles').select('*').eq('id',verified.data.user.id).maybeSingle();
      if(generation!==authGeneration)return;
      if(access.error||!access.data||!access.data.is_active){accessLoading=false;profile=null;error='Sua conta não tem acesso ativo. Procure o administrador da empresa.';render();return;}
      profile=access.data;
      const resultStores=await client.from('stores').select('id,name').order('name');if(generation!==authGeneration)return;if(resultStores.error)throw new Error('Não foi possível consultar os quiosques.');
      stores=resultStores.data||[];if(!stores.some(s=>s.id===selectedStore))selectedStore=profile.store_id||stores[0]?.id||'';
      await refresh();if(generation!==authGeneration)return;accessLoading=false;subscribe();render();
    }catch(problem){if(generation===authGeneration){accessLoading=false;showError(problem);}}finally{initializing=false;if(generation!==authGeneration&&auth)setTimeout(initialize,0);}
  }
  function login(){
    const passwordFlow=needsPassword&&Boolean(auth);
    $('#app').innerHTML=`<div class="login"><section class="login-story"><a class="brand" href="/">valance<span class="brand-os">OS</span></a><div><span class="eyebrow">GESTÃO QUE APROXIMA</span><h1>Boas conexões.<br>Novas possibilidades.</h1><p>Clientes, equipe e resultados em um só lugar.</p></div></section><section class="login-form-wrap"><form id="production-login"><span class="eyebrow">ACESSO À EMPRESA</span><h2>${passwordFlow?'Defina sua senha':'Vamos começar?'}</h2><p>${passwordFlow?'Escolha uma senha para sua conta.':'Use o e-mail cadastrado pelo administrador.'}</p>${passwordFlow?field('password','Nova senha','password','','required minlength="12" autocomplete="new-password"')+field('confirm','Confirme a senha','password','','required minlength="12" autocomplete="new-password"'):field('email','E-mail','email','','required autocomplete="username"')+field('password','Senha','password','','required autocomplete="current-password"')}<p class="error" id="production-error" role="alert">${e(error)}</p><button class="btn lime full" type="submit">${passwordFlow?'Salvar senha':'Entrar'}</button>${!passwordFlow?button('Esqueci minha senha','forgot','text-btn'):''}${auth?button('Sair da conta','logout','text-btn'):''}</form></section></div><div id="modal-root"></div>`;
    $('#production-login').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;error='';const data=new FormData(event.target);const submit=event.target.querySelector('[type=submit]');submit.disabled=true;try{
      if(passwordFlow){if(data.get('password')!==data.get('confirm'))throw new Error('As senhas devem ser iguais.');const result=await client.auth.updateUser({password:data.get('password')});if(result.error)throw result.error;needsPassword=false;history.replaceState(null,'',location.pathname);await initialize();}
      else{needsPassword=false;const result=await client.auth.signInWithPassword({email:data.get('email'),password:data.get('password')});if(result.error)throw new Error('E-mail ou senha inválidos, ou conta indisponível.');await initialize();}
    }catch(problem){showError(problem);}finally{busy=false;submit.disabled=false;}};
  }
  function reportSellers(){
    const people=new Map(staff.filter(person=>person.role==='seller').map(person=>[person.id,{id:person.id,name:person.name}]));
    for(const row of snapshot?.by_seller||[])if(row.seller_id)people.set(row.seller_id,{id:row.seller_id,name:row.name});
    return [...people.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  }
  function filters(){return `<form class="card feature-filters" id="production-filters"><div class="filter-fields"><label>De<input name="from" type="date" required value="${from}"></label><label>Até<input name="to" type="date" required value="${to}"></label><label>Quiosque<select name="store">${stores.map(s=>option(s.id,s.name,selectedStore)).join('')}</select></label><label>Vendedor<select name="seller"><option value="">Todos os autorizados</option>${reportSellers().map(p=>option(p.id,p.name,sellerFilter)).join('')}</select></label><label>Agenda<select name="agenda"><option value="">Todas as agendas</option>${agendas.map(a=>option(a.id,a.name,agendaFilter)).join('')}</select></label><label>Venda mínima (R$)<input type="number" name="minimum" min="0" step="0.01" value="${minimum}"></label><button class="btn lime" type="submit">Filtrar</button></div></form>`;}
  function toolbar(){return `<div class="header-tools">${button(icon('message-circle')+' WhatsApp','whatsapp','quick-whatsapp-trigger')}${button(icon('search'),'search','icon-btn')}<div class="local-time"><div><time id="production-clock"></time><span>Hora local</span></div></div></div>`;}
  function content(){
    const t=snapshot?.totals||{};
    if(route==='profile')return `<form class="card profile-form" id="production-profile"><h2>Meu perfil</h2>${field('name','Nome','text',profile.name,'required maxlength="100"')}${field('handle','Perfil','text',profile.handle||'','maxlength="80"')}<p>${e(profile.email)} · ${e(profile.role)}</p><button type="submit" class="btn lime">Salvar alterações</button>${button('Alterar senha','change-password')}</form>`;
    if(route==='imports')return `<section class="card production-panel"><h2>Importar dados do PDV</h2><p>A conexão automática com o Presence ainda não está configurada. Importe os arquivos exportados do PDV nos modelos abaixo. Os dados confirmados são atualizados para os usuários conectados.</p><div class="actions">${button('Modelo de clientes','template:customers')}${button('Modelo de vendas','template:sales')}</div><form id="production-import"><label>Conteúdo<select name="kind"><option value="customers">Clientes</option><option value="sales">Vendas</option></select></label><label>Arquivo CSV (até 500 linhas / 1 MB)<input name="file" type="file" accept=".csv,text/csv" required></label><p>Cadastre o código do vendedor no PDV antes de importar vendas. Datas de venda devem incluir horário e fuso. Importações com o mesmo código atualizam o registro existente.</p><button class="btn lime" type="submit">Validar e importar para ${e(stores.find(s=>s.id===selectedStore)?.name)}</button></form><h3>Última sincronização</h3><p>${snapshot?.latest_sync?`Status: ${e(snapshot.latest_sync.status)} · ${e(new Date(snapshot.latest_sync.started_at).toLocaleString('pt-BR'))}`:'Nenhuma importação registrada.'}</p></section>`;
    if(route==='users')return `<section class="card"><div class="card-heading"><h2>${profile.role==='admin'?'Equipe do quiosque e administradores':'Equipe do quiosque'}</h2><div class="actions">${button('Compartilhar lista','share-users')}${isManager()?button('Convidar funcionário','invite','lime'):''}</div></div>${table(['Nome','E-mail','Função','Código PDV','Acesso','Ações'],staff.map(p=>[e(p.name),e(p.email),e(roleLabels[p.role]||p.role),e(p.external_id||'—'),p.is_active?'Ativo':'Desativado',(profile.role==='admin'||profile.role==='manager'&&p.role==='seller')?`<div class="actions">${button('Editar','edit:'+p.id,'small')}${profile.role==='admin'?button('Alterar função','role:'+p.id,'small'):''}${p.id!==profile.id?button(p.is_active?'Desativar':'Reativar','access:'+p.id,'small'):''}${button('Recuperar senha','reset:'+p.id,'small')}</div>`:'']))}</section>`;
    if(route==='customers')return `<section class="card"><form id="production-customer-search" class="card-heading"><label>Buscar clientes<input name="query" value="${e(query)}" placeholder="Nome do cliente"></label><button class="btn" type="submit">Buscar</button></form>${table(['Cliente','Telefone','Aniversário','Última compra'],customers.map(c=>[e(c.name),e(c.phone),e(c.birth_date||'—'),e(c.last_purchase_at?new Date(c.last_purchase_at).toLocaleDateString('pt-BR'):'—')]))}<p class="report-footnote">Até 50 resultados por busca. O acesso aos clientes respeita sua carteira e seu quiosque.</p></section>`;
    if(route==='distribution')return `<section class="card production-panel"><h2>Distribuir contatos</h2><p>A distribuição é confirmada no banco e preserva tarefas já atribuídas.</p><form id="production-distribution"><label>Agenda<select name="agenda_id" required>${agendas.map(a=>option(a.id,a.name)).join('')}</select></label>${field('quantity','Quantidade','number',10,'required min="1" max="500"')}<fieldset><legend>Vendedores ativos</legend>${staff.filter(s=>s.role==='seller'&&s.is_active&&s.store_id===selectedStore).map(s=>`<label class="seller-check"><input type="checkbox" name="sellers" value="${s.id}">${e(s.name)}</label>`).join('')}</fieldset><button class="btn lime" type="submit">Confirmar distribuição</button></form><form id="production-generate"><label>Gerar tarefas da agenda<select name="agenda_id" required>${agendas.map(a=>option(a.id,a.name)).join('')}</select></label><p>Gera os contatos elegíveis conforme a regra da agenda, sem duplicar tarefas existentes.</p><button class="btn" type="submit">Gerar contatos</button></form></section>`;
    if(route==='agendas'){const status=agendaDayMessage(agendaDay);return `${status?`<section class="card production-panel agenda-day-status"><h2>${e(status.title)}</h2><p>${e(status.description)}</p></section>`:''}<section class="card"><div class="card-heading"><h2>Contatos e atendimentos</h2><span>${number(t.contacts_completed)} realizados no período</span></div>${tasks.length?table(['Cliente','Agenda','Data','Situação','Ações'],tasks.map(task=>[e(task.customer?.name||'Cliente'),e(task.agenda?.name||'Agenda'),e(task.due_date),task.status==='completed'?'Realizado':'Pendente',`<div class="actions">${!task.customer?.do_not_contact?button(task.customer?.phone?'WhatsApp':'Informar número','contact-whatsapp:'+task.id,'small'):''}${task.status!=='completed'?button('Registrar atendimento','complete:'+task.id,'small lime'):''}</div>`])):'<div class="empty">Não há contatos nesta página. O gerente pode importar clientes e gerar as agendas.</div>'}<div class="table-footer">Página ${taskPage+1}<span>${taskPage?button('Anterior','task-prev','small'):''}${tasks.length===50?button('Próxima','task-next','small'):''}</span></div></section>`;}
    return renderReportPage({route,snapshot:reportContext(),profile,selectedStore,from,to});
  }

  function render(){
    document.documentElement.dataset.theme=localStorage.getItem('valance-theme')||'dark';
    if(accessLoading&&auth&&!needsPassword){$('#app').innerHTML='<main class="production-access-loading" role="status"><h1>Atualizando seu acesso</h1><p>Aguarde um momento.</p></main><div id="modal-root"></div>';return;}
    if(!auth||!profile||needsPassword){login();return;}
    if(!isManager()&&['distribution','imports','users','by-store','store'].includes(route))route='overview';
    const routes=Object.entries(names).filter(([name])=>isManager()||!['distribution','imports','users','by-store','store'].includes(name));
    $('#app').innerHTML=`<aside class="sidebar ${drawer?'production-drawer-open':''}" aria-label="Workspace"><button class="icon-btn drawer-close" data-action="menu" aria-label="Fechar menu">${icon('x')}</button><a class="brand" href="/">valance<span class="brand-os">OS</span></a><div class="workspace"><div><b>${e(stores.find(s=>s.id===selectedStore)?.name||'Empresa')}</b><span>${e(profile.role)}</span></div></div><nav>${routes.map(([key,name])=>`<button class="nav-item ${route===key?'active':''}" data-action="nav:${key}">${e(name)}</button>`).join('')}</nav><div class="sidebar-bottom">${button('Alternar tema','theme')}${button('Sair da conta','logout')}</div></aside>${drawer?'<button class="mobile-shade production-shade" data-action="menu" aria-label="Fechar menu"></button>':''}<div class="main-shell"><header class="topbar"><a class="brand header-brand" href="/">valance<span class="brand-os">OS</span></a>${toolbar()}<button class="workspace-trigger user-menu" data-action="menu">${e(profile.name)} ${icon('menu')}</button></header><main><div class="page-title"><div><span class="eyebrow">${e(stores.find(s=>s.id===selectedStore)?.name||'Workspace')}</span><h1>${route==='overview'?`<span id="production-greeting"></span>`:e(names[route])}</h1></div><span class="tag" id="realtime-state">${e(realtime)}</span></div><div class="production-source">Presence não conectado · Entrada por importação CSV · Atualização interna em tempo real</div><p id="production-error" class="error" role="alert">${e(error)}</p><p id="production-notice" class="success-notice" role="status" hidden></p>${!['profile','users'].includes(route)?filters():''}${content()}</main><footer>Valance OS · ${e(profile.role)}</footer></div><div id="modal-root"></div>`;
    createIcons({icons});bind();updateClock();
  }
  function dialog(title,body,formId=''){
    lastFocus=document.activeElement;modal=title;$('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="production-dialog-title"><button class="modal-close icon-btn" data-action="close" aria-label="Fechar">${icon('x')}</button><h2 id="production-dialog-title">${e(title)}</h2>${formId?`<form id="${formId}">${body}<p class="error dialog-error" role="alert"></p><button class="btn lime full" type="submit">Confirmar</button></form>`:body}</section></div>`;createIcons({icons});($('.modal input')||$('.modal button'))?.focus();
  }
  function closeDialog(){modal='';$('#modal-root').innerHTML='';lastFocus?.focus();}
  function handleForm(id,fn){const form=$('#'+id);if(form)form.onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;const submit=form.querySelector('[type=submit]');if(submit)submit.disabled=true;try{await fn(new FormData(form));}catch(problem){const node=form.querySelector('.dialog-error');if(node)node.textContent=problem.message;else showError(problem);}finally{busy=false;if(submit)submit.disabled=false;}};}
  function bind(){
    handleForm('production-filters',async data=>{
      if(data.get('from')>data.get('to'))throw new Error('A data inicial deve ser anterior à final.');
      const generation=authGeneration,previous={from,to,selectedStore,sellerFilter,agendaFilter,minimum,taskPage,snapshot,tasks,customers,staff,agendas,agendaDay};
      const changed=selectedStore!==data.get('store');
      from=data.get('from');to=data.get('to');selectedStore=data.get('store');sellerFilter=changed?'':data.get('seller');agendaFilter=data.get('agenda');minimum=Number(data.get('minimum')||0);taskPage=0;
      try{await refresh();if(generation!==authGeneration)throw new SessionChanged();if(changed)subscribe();error='';render();}
      catch(problem){if(generation===authGeneration){refreshVersion++;({from,to,selectedStore,sellerFilter,agendaFilter,minimum,taskPage,snapshot,tasks,customers,staff,agendas,agendaDay}=previous);render();}throw problem;}
    });
    handleForm('production-profile',async data=>{await rpc('save_own_profile',{p_name:data.get('name'),p_handle:data.get('handle')});profile.name=data.get('name');profile.handle=data.get('handle');render();notify('Perfil atualizado.');});
    handleForm('production-customer-search',async data=>{query=data.get('query').trim();await refresh();render();});
    handleForm('production-distribution',async data=>{const sellers=data.getAll('sellers');if(!sellers.length)throw new Error('Selecione ao menos um vendedor.');await rpc('assign_contacts',{p_store_id:selectedStore,p_agenda_id:data.get('agenda_id'),p_quantity:Number(data.get('quantity')),p_seller_ids:sellers});await refresh();render();notify('Distribuição concluída.');});
    handleForm('production-generate',async data=>{const result=await rpc('generate_agenda_tasks',{p_store_id:selectedStore,p_agenda_id:data.get('agenda_id')});await refresh();render();notify(`Geração concluída: ${typeof result==='number'?result:'consulte a agenda'} novos contatos.`);});
    handleForm('production-import',async data=>{const file=data.get('file');if(file.size>1000000)throw new Error('Selecione um CSV de até 1 MB.');const kind=data.get('kind'),rows=parseImportCSV(await file.text(),kind);await api('import-presence',{store_id:selectedStore,payload:{customers:kind==='customers'?rows:[],sales:kind==='sales'?rows:[]}});await refresh();render();notify('Importação confirmada. Os usuários conectados receberão a atualização.');});
  }
  function openWhatsapp(phone=''){
    dialog('Iniciar conversa no WhatsApp',`${field('phone','Número com DDD','tel',phone,'id="live-phone" autocomplete="off"')}<p class="hint">Use DDD e número. Para outros países, inclua + e o código do país.</p><a class="btn lime full" id="live-wa-link" href="#" target="_blank" rel="noopener noreferrer">Abrir conversa no WhatsApp</a><p id="live-wa-error" class="error" role="alert"></p><input id="live-wa-url" readonly aria-label="Link da conversa" hidden>`);
    const input=$('#live-phone'),link=$('#live-wa-link'),url=$('#live-wa-url');function update(show=false){try{link.href='https://wa.me/'+normalizePhone(input.value);url.value=link.href;url.hidden=false;$('#live-wa-error').textContent='';return true;}catch(problem){link.href='#';url.hidden=true;if(show)$('#live-wa-error').textContent=problem.message;return false;}}input.oninput=()=>update();link.onclick=event=>{if(!update(true))event.preventDefault();};input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();link.click();}};if(phone)update();
  }
  function showShare(title,text){
    dialog(title,`<textarea id="production-share-text" readonly rows="8" aria-label="Conteúdo para compartilhar">${e(text)}</textarea><div class="actions">${button('Copiar','copy-share')}<a class="btn lime" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>${button('Baixar arquivo','download-share')}</div><p class="share-hint hint">Confira o conteúdo e escolha com quem compartilhar.</p>`);
  }
  function roleStoreField(value){return `<label class="role-store-field">Quiosque de acesso<select name="store_id" required>${stores.map(store=>option(store.id,store.name,value)).join('')}</select></label><p class="role-help hint"></p>`;}
  function bindRoleStore(formId){
    const form=$('#'+formId),role=form.querySelector('[name="role"]'),store=form.querySelector('[name="store_id"]');
    const update=()=>{const global=role.value==='admin';store.disabled=global;store.required=!global;form.querySelector('.role-store-field').hidden=global;form.querySelector('.role-help').textContent=global?'Administrador tem acesso aos dois quiosques.':role.value==='manager'?'Gerente administra somente o quiosque escolhido.':'Vendedor acessa sua carteira e seus resultados no quiosque escolhido.';};
    role.onchange=update;update();
  }
  async function action(name,arg){
    if(busy&&!['close','menu','theme'].includes(name))throw new Error('Aguarde a operação em andamento.');
    if(name==='menu'){drawer=!drawer;render();}
    else if(name==='theme'){localStorage.setItem('valance-theme',document.documentElement.dataset.theme==='dark'?'light':'dark');render();}
    else if(name==='nav'){route=arg;drawer=false;error='';await refresh();render();}
    else if(name==='close')closeDialog();
    else if(name==='logout'){const generation=authGeneration;const result=await client.auth.signOut();if(result.error)throw new Error('Não foi possível sair da conta. Tente novamente.');if(generation===authGeneration){clearWorkspace(false);auth=null;render();}}
    else if(name==='forgot'){
      dialog('Recuperar senha',field('email','E-mail','email','','required'),'recovery-form');handleForm('recovery-form',async data=>{const r=await client.auth.resetPasswordForEmail(data.get('email'),{redirectTo:location.origin+'/?auth=recovery'});if(r.error)throw new Error('Não foi possível solicitar a recuperação. Tente novamente mais tarde.');$('.modal form').innerHTML='<p>Se o e-mail estiver cadastrado e apto à recuperação, você receberá as instruções.</p>';});
    }
    else if(name==='change-password'){
      dialog('Alterar senha',field('password','Nova senha','password','','required minlength="12" autocomplete="new-password"')+field('confirm','Confirme a senha','password','','required minlength="12"'),'password-form');handleForm('password-form',async data=>{if(data.get('password')!==data.get('confirm'))throw new Error('As senhas devem ser iguais.');const r=await client.auth.updateUser({password:data.get('password')});if(r.error)throw r.error;closeDialog();notify('Senha alterada.');});
    }
    else if(name==='whatsapp')openWhatsapp();
    else if(name==='contact-whatsapp'){const customer=tasks.find(t=>t.id===arg)?.customer;if(customer?.do_not_contact)throw new Error('Este cliente solicitou não receber contatos.');openWhatsapp(customer?.phone||'');}
    else if(name==='complete'){
      dialog('Registrar atendimento',`<label>Resultado<select name="outcome"><option value="contacted">Contato realizado</option><option value="no_response">Sem resposta</option><option value="invalid_number">Número inválido</option><option value="opt_out">Não deseja contato</option></select></label><p>Confirmação manual: abrir o WhatsApp não confirma o envio da mensagem.</p>`,'complete-form');handleForm('complete-form',async data=>{await rpc('complete_contact',{p_task_id:arg,p_outcome:data.get('outcome')});closeDialog();await refresh();render();notify('Atendimento registrado.');});
    }
    else if(name==='invite'){
      if(!isManager())throw new Error('Acesso não autorizado.');
      dialog('Convidar funcionário',field('name','Nome','text','','required maxlength="100"')+field('email','E-mail','email','','required')+`<label>Função<select name="role"><option value="seller">Vendedor</option>${profile.role==='admin'?'<option value="manager">Gerente</option><option value="admin">Administrador</option>':''}</select></label>`+roleStoreField(selectedStore)+field('external_id','Código do vendedor no PDV','text','','maxlength="100"'),'invite-form');
      bindRoleStore('invite-form');
      handleForm('invite-form',async data=>{
        const role=data.get('role');await api('invite-user',{store_id:role==='admin'?null:data.get('store_id'),name:data.get('name'),email:data.get('email'),role,external_id:data.get('external_id')||undefined});
        const generation=authGeneration;closeDialog();try{await refresh();}catch(problem){if(problem instanceof SessionChanged)throw problem;showError(problem);}
        if(generation!==authGeneration)throw new SessionChanged();render();showShare('Convite enviado',invitationShareText({name:data.get('name'),email:data.get('email'),siteUrl:location.origin}));
      });
    }
    else if(name==='role'){
      if(profile.role!=='admin')throw new Error('Somente administradores podem alterar funções.');
      const person=staff.find(p=>p.id===arg);if(!person)throw new Error('Funcionário não encontrado.');const self=person.id===profile.id;
      dialog('Alterar função',`<p>${e(person.name)} · Função atual: <b>${e(roleLabels[person.role])}</b></p><label>Nova função<select name="role">${Object.entries(roleLabels).map(([value,label])=>option(value,label,person.role)).join('')}</select></label>`+roleStoreField(person.store_id||selectedStore)+`<p>O histórico de vendas e atendimentos será preservado.</p>${self?'<p>Ao mudar sua própria função, seu acesso será atualizado após a confirmação.</p>':''}<label class="role-confirm"><input type="checkbox" name="confirm" required> Confirmo a alteração de acesso desta pessoa.</label>`,'role-form');
      bindRoleStore('role-form');
      handleForm('role-form',async data=>{
        const role=data.get('role');await api('change-role',{user_id:person.id,role,store_id:role==='admin'?null:data.get('store_id')});closeDialog();
        if(self){await verifyAccess(true);if(profile)notify('Sua função foi atualizada.');return;}
        await refresh();render();notify('Função e permissões atualizadas.');
      });
    }
    else if(name==='edit'){
      const person=staff.find(p=>p.id===arg);if(!person)throw new Error('Funcionário não encontrado.');dialog('Editar funcionário',field('name','Nome','text',person.name,'required maxlength="100"')+field('handle','Perfil','text',person.handle||'')+field('coupon','Cupom','text',person.coupon||'')+field('external_id','Código no PDV','text',person.external_id||''),'edit-form');handleForm('edit-form',async data=>{await api('update-user',{user_id:arg,name:data.get('name'),handle:data.get('handle'),coupon:data.get('coupon'),external_id:data.get('external_id')||null});closeDialog();await refresh();render();notify('Funcionário atualizado.');});
    }
    else if(name==='access'){
      const person=staff.find(p=>p.id===arg);if(!person)throw new Error('Funcionário não encontrado.');dialog(person.is_active?'Desativar acesso':'Reativar acesso',`<p>${e(person.name)}. O histórico será preservado. Contatos pendentes podem ser redistribuídos conforme a política de acesso.</p>`,'access-form');handleForm('access-form',async()=>{await api('set-access',{user_id:arg,is_active:!person.is_active});closeDialog();await refresh();render();notify('Acesso atualizado.');});
    }
    else if(name==='reset'){await api('reset-user',{user_id:arg});notify('Solicitação de recuperação enviada. Nenhuma senha é compartilhada.');}
    else if(name==='target'){
      dialog('Definir meta',`<label>Responsável<select name="seller_id"><option value="">Loja</option>${staff.filter(p=>p.role==='seller'&&p.store_id===selectedStore).map(p=>option(p.id,p.name)).join('')}</select></label>`+field('amount','Meta bruta (R$)','number','','required min="0" step="0.01"')+field('period','Início do mês','date',from.slice(0,8)+'01','required'),'target-form');handleForm('target-form',async data=>{await rpc('save_target',{p_store_id:selectedStore,p_seller_id:data.get('seller_id')||null,p_period_start:data.get('period'),p_amount:Number(data.get('amount'))});closeDialog();await refresh();render();notify('Meta cadastrada.');});
    }
    else if(name==='share-users'){showShare('Compartilhar equipe',staffShareText(staff,stores.find(s=>s.id===selectedStore)?.name||'Quiosque',location.origin));}
    else if(name==='share-report'){const data=currentRows();showShare(names[route],`${names[route]} · ${from} a ${to}\n`+csvText([data.headers,...data.rows]));}
    else if(name==='copy-share'){try{await navigator.clipboard.writeText($('#production-share-text').value);notify('Conteúdo copiado.');}catch{const input=$('#production-share-text');input.focus();input.select();$('.share-hint').textContent='Conteúdo selecionado. Use Copiar no seu dispositivo.';}}
    else if(name==='download-share'){downloadFile($('#production-share-text').value,'valance-compartilhamento.txt','text/plain;charset=utf-8');}
    else if(name==='ranking'){dialog('Ranking de vendedores',table(['Posição','Vendedor','Vendas brutas'],[...(snapshot?.by_seller||[])].sort((a,b)=>Number(b.gross)-Number(a.gross)).map((r,n)=>[n+1,e(r.name),money(r.gross)])));}
    else if(name==='template'){downloadFile(csvText([importHeaders[arg]]),`modelo-${arg}.csv`,'text/csv;charset=utf-8');}
    else if(name==='excel'||name==='csv'){const rows=currentRows(),matrix=rows.tables?.length>1?rows.tables.flatMap(t=>[[t.title],t.headers,...t.rows,[]]):[rows.headers,...rows.rows];downloadFile(name==='excel'?workbookBytes(rows.tables||[{title:names[route],headers:rows.headers,rows:rows.rows}]):csvText(matrix),`valance-${route}.${name==='excel'?'xlsx':'csv'}`,name==='excel'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv;charset=utf-8');}
    else if(name==='task-prev'||name==='task-next'){taskPage=Math.max(0,taskPage+(name==='task-next'?1:-1));await refresh();render();}
    else if(name==='search'){
      dialog('Pesquisar no sistema',field('search','Telas, contatos e equipe','search','','id="live-search"')+'<div id="live-search-results"></div>');const update=()=>{const term=$('#live-search').value.toLocaleLowerCase('pt-BR').trim();const matches=Object.entries(names).filter(([key,value])=>(isManager()||!['distribution','imports','users','by-store','store'].includes(key))&&value.toLowerCase().includes(term));$('#live-search-results').innerHTML=matches.map(([key,label])=>button(e(label),'search-route:'+key)).join('')+(term?staff.filter(p=>[p.name,p.handle,p.cpf,p.coupon,p.external_id].join(' ').toLocaleLowerCase('pt-BR').includes(term)).map(p=>button(e(p.name),'search-staff:'+p.id)).join(''):'')+(term?agendas.filter(a=>a.name.toLocaleLowerCase('pt-BR').includes(term)).map(a=>button('Agenda: '+e(a.name),'search-agenda:'+a.id)).join(''):'')+(term?`<p>Para buscar clientes no banco: ${button('Consultar clientes','search-customers')}</p>`:'');};$('#live-search').oninput=update;update();
    }
    else if(name==='search-staff'){closeDialog();await action('nav',isManager()?'users':'profile');}
    else if(name==='search-agenda'){agendaFilter=arg;closeDialog();await action('nav','agendas');}
    else if(name==='search-route'){closeDialog();await action('nav',arg);}
    else if(name==='search-customers'){query=$('#live-search').value.trim();closeDialog();await action('nav','customers');}
  }
  document.addEventListener('click',event=>{const node=event.target.closest('[data-action]');if(!node)return;const [name,...parts]=node.dataset.action.split(':');action(name,parts.join(':')).catch(showError);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(modal)closeDialog();else if(drawer){drawer=false;render();}}if(modal&&event.key==='Tab'){const list=[...document.querySelectorAll('.modal button,.modal input:not([hidden]),.modal select,.modal a[href]')];if(event.shiftKey&&document.activeElement===list[0]){event.preventDefault();list.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===list.at(-1)){event.preventDefault();list[0]?.focus();}}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&profile){event.preventDefault();action('search');}});
  function updateClock(){if($('#production-clock'))$('#production-clock').textContent=new Date().toLocaleTimeString('pt-BR');if($('#production-greeting'))$('#production-greeting').textContent=`${greetingForHour(new Date().getHours())}, ${profile?.name?.split(' ')[0]||''}.`;}
  setInterval(updateClock,1000);
  async function verifyAccess(force=false){
    if(!profile||document.hidden&&!force)return;
    const previous=profile,generation=authGeneration;
    const result=await client.from('profiles').select('id,is_active,role,store_id').eq('id',previous.id).maybeSingle();
    if(generation!==authGeneration)return;
    if(result.error||!result.data||!result.data.is_active){clearWorkspace(false);error='Seu acesso não está disponível. Entre novamente ou procure o administrador.';render();}
    else if(authorizationChanged(result.data))await reloadAuthorization();
  }
  setInterval(()=>verifyAccess().catch(showError),60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&auth)verifyAccess().catch(showError);});
  client.auth.onAuthStateChange((event,session)=>{
    const changed=auth?.user?.id!==session?.user?.id;
    if(changed||event==='SIGNED_OUT')clearWorkspace(Boolean(session));
    auth=session;if(event==='PASSWORD_RECOVERY')needsPassword=true;
    if(changed||event==='SIGNED_OUT')render();
    if(session&&(changed||['SIGNED_IN','PASSWORD_RECOVERY'].includes(event)))setTimeout(initialize,0);
  });
  render();await initialize();
}
