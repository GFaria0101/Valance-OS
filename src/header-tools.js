// Times follow the browser's local clock, independently of the demonstration data.
export function greetingForHour(hour){return hour>=5&&hour<12?'Bom dia':hour>=12&&hour<18?'Boa tarde':'Boa noite';}
export function normalizePhone(raw){
  const input=String(raw).trim();
  if(!input||!/^\+?[\d\s().-]+$/.test(input))throw new Error('Digite um número válido com DDD. Para outros países, inclua + e o código do país.');
  let digits=input.replace(/\D/g,'');
  if(!input.startsWith('+')){
    if(digits.length===10||digits.length===11)digits='55'+digits;
    else if(!digits.startsWith('55')||![12,13].includes(digits.length))throw new Error('Inclua o DDD brasileiro ou use + e o código do país.');
  }
  if(!/^[1-9]\d{7,14}$/.test(digits))throw new Error('Confira o código do país e o número informado.');
  if(digits.startsWith('55')){
    const local=digits.slice(2),ddd=local.slice(0,2);
    const ddds='11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' ');
    if(!ddds.includes(ddd)||!(/^\d{2}[2-5]\d{7}$/.test(local)||/^\d{2}9\d{8}$/.test(local)))throw new Error('Confira o DDD e o número: celular brasileiro tem 9 dígitos após o DDD.');
  }
  return digits;
}
const normalize=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function searchEntries(entries,query){
  const numeric=/^[\d.()\s-]+$/.test(query)&&/\d/.test(query);
  const words=(numeric?query.replace(/\D/g,''):normalize(query)).split(/\s+/).filter(Boolean);
  if(!words.length)return entries.filter(item=>item.kind==='screen').slice(0,8);
  return entries.filter(item=>words.every(word=>normalize(`${item.name} ${item.detail} ${item.terms||''}`).includes(word)))
    .sort((a,b)=>Number(normalize(b.name).startsWith(normalize(query)))-Number(normalize(a.name).startsWith(normalize(query))));
}

export function createHeaderTools(ctx){
  const {i,escapeHtml:e}=ctx;
  let phoneDraft='',searchQuery='',matches=[];
  const $=selector=>document.querySelector(selector);
  const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter=new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const greeting=()=>`${greetingForHour(new Date().getHours())}, ${(ctx.name()||'João').split(' ')[0]}.`;
  function updateTime(){
    const now=new Date(),clock=$('#local-clock');
    if(clock){clock.textContent=formatter.format(now);clock.dateTime=now.toISOString();}
    const welcome=$('[data-local-greeting]');if(welcome)welcome.textContent=greeting();
  }
  setInterval(updateTime,1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateTime();});
  function markup(){return `<div class="header-tools"><button class="quick-whatsapp-trigger" data-action="tool-whatsapp" aria-label="Abrir WhatsApp" aria-haspopup="dialog">${i('message-circle')}<span>WhatsApp</span></button><button class="icon-btn site-search-trigger" data-action="tool-search" aria-label="Pesquisar no site" title="Pesquisar no site (Ctrl+K)">${i('search')}</button><div class="local-time" title="Horário do seu dispositivo · ${e(zone)}">${i('clock-3')}<div><time id="local-clock" datetime="${new Date().toISOString()}">${formatter.format(new Date())}</time><span>Hora local</span></div></div></div>`;}
  function entries(){
    const pageTerms={
      overview:'início home resumo dashboard indicadores vendas contatos conversão gráfico',
      agendas:'agenda clientes contatos aniversário aniversariantes pós-venda recompra reativação concluir atendimento próximas agendas',
      sales:'vendas meta conversão posição ranking comparação ano anterior',
      generated:'relatórios gerou agenda SSS filtros avançados datas personalizadas indicadores Excel XLSX CSV tabela vendedor compartilhar',
      'by-store':'relatórios gerou loja faturamento SSS Excel CSV datas filtros',
      realtime:'relatórios tempo real ranking calendário 364 dias salão CDIG STV mala projeção meta OFF ON last year',
      performance:'dedo duro produtividade contatos preferencial gotas disponíveis feitos pendentes total',
      distribution:'distribuir distribuição contatos vendedor atribuir divisão prévia histórico',
      store:'painel loja ticket médio peças atendimento canal digital física meta vendas dia equipe',
      users:'vendedores usuários cupom CPF acesso senha resetar gerar WhatsApp compartilhar lista editar',
      profile:'perfil configurações nome email senha conta tema claro escuro'
    };
    const pages=Object.entries(ctx.labels).map(([route,name])=>({kind:'screen',name,detail:'Abrir tela',terms:pageTerms[route]||'',route}));
    const sellers=ctx.users().map((user,index)=>({kind:'seller',name:user[0],detail:`Vendedor · @${user[1]} · Cupom ${user[3]}`,terms:`${user[2]} ${user[3]} ${user[4]?'ativo':'inativo'}`,index}));
    const agendas=ctx.agendas.map((a,index)=>({kind:'agenda',name:a[0],detail:'Agenda · visualizar contatos',terms:a[1]+' '+a[6],index}));
    return [...pages,...sellers,...agendas,...ctx.contacts()];
  }
  function modalContent(kind='search'){
    if(kind==='whatsapp')return `<span class="square-icon">${i('message-circle')}</span><h2>Iniciar conversa no WhatsApp</h2><p>Digite o número da pessoa com quem deseja conversar.</p><form id="quick-whatsapp" class="whatsapp-dialog-form" novalidate><label for="whatsapp-number">Número com DDD<input id="whatsapp-number" name="phone" type="tel" inputmode="tel" autocomplete="off" placeholder="(11) 99999-9999" value="${e(phoneDraft)}" aria-describedby="whatsapp-help whatsapp-error"></label><p class="hint" id="whatsapp-help">Brasil: DDD e número. Outros países: inclua + e o código do país, por exemplo +351.</p><p id="whatsapp-error" class="error" role="alert" hidden></p><button type="submit" class="btn lime full">${i('arrow-up-right')}Abrir conversa no WhatsApp</button><p class="hint whatsapp-open-fallback" id="whatsapp-open-fallback" hidden>Se não abriu, <a id="whatsapp-direct-link" target="_top" rel="noreferrer">clique aqui para abrir o WhatsApp nesta aba</a>.</p></form>`;
    return `<span class="square-icon">${i('search')}</span><h2>Pesquisar no site</h2><p>Encontre telas, recursos, vendedores e contatos.</p><label class="global-search-field" for="site-search">${i('search')}<input id="site-search" type="search" autocomplete="off" placeholder="Ex.: ticket médio, Carlos, cupom…" value="${e(searchQuery)}" aria-controls="site-search-results"></label><div id="search-count" class="search-count" role="status"></div><div id="site-search-results" class="site-search-results"></div><p class="search-hint">Ctrl+K para abrir · Esc para fechar · Tab para escolher um resultado</p>`;}
  function drawResults(){
    matches=searchEntries(entries(),searchQuery);
    const shown=matches.slice(0,24);
    $('#search-count').textContent=searchQuery.trim()?`${matches.length} resultado${matches.length===1?'':'s'}${matches.length>24?' · mostrando os primeiros 24':''}`:'Acesso rápido';
    const kindNames={screen:'Tela',seller:'Vendedor',agenda:'Agenda',contact:'Contato'};
    $('#site-search-results').innerHTML=shown.map((item,index)=>`<button class="search-result" data-action="tool-result:${index}"><span class="search-result-icon">${i(item.kind==='seller'||item.kind==='contact'?'users':item.kind==='agenda'?'calendar-days':'files')}</span><span><b>${e(item.name)}</b><small>${e(item.detail)}</small></span><span class="search-kind">${kindNames[item.kind]}</span>${i('arrow-up-right')}</button>`).join('')||'<div class="empty">Nenhum resultado encontrado. Tente outro nome, CPF, cupom ou recurso.</div>';
    ctx.icons();
  }
  function bindModal(){
    if($('#quick-whatsapp')){bindPhone();return;}
    const input=$('#site-search');if(!input)return;
    drawResults();input.oninput=()=>{searchQuery=input.value;drawResults();};input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();$('#site-search-results button')?.click();}else if(event.key==='ArrowDown'){event.preventDefault();$('#site-search-results button')?.focus();}};input.focus();
  }
  function bind(){updateTime();}
  function bindPhone(){
    const form=$('#quick-whatsapp');if(!form)return;
    const input=$('#whatsapp-number'),error=$('#whatsapp-error'),fallback=$('#whatsapp-open-fallback'),link=$('#whatsapp-direct-link');
    input.oninput=()=>{phoneDraft=input.value;error.hidden=true;fallback.hidden=true;link.removeAttribute('href');input.removeAttribute('aria-invalid');};
    form.onsubmit=event=>{
      event.preventDefault();
      let phone;
      try{phone=normalizePhone(input.value);}
      catch(problem){error.textContent=problem.message;error.hidden=false;input.setAttribute('aria-invalid','true');input.focus();return;}
      error.hidden=true;input.removeAttribute('aria-invalid');
      const url=`https://wa.me/${phone}`;
      link.href=url;fallback.hidden=false;
      // Same-tab navigation works even when the browser blocks popup windows.
      try{window.location.assign(url);}
      catch{error.textContent='Não foi possível abrir automaticamente. Use o link abaixo.';error.hidden=false;}
    };
  }
  function openSearch(){searchQuery='';ctx.openModal('tools','search');}
  function handle(action,arg){
    if(action==='tool-search'){openSearch();return;}
    if(action==='tool-whatsapp'){ctx.openModal('tools','whatsapp');return;}
    if(action==='tool-result'){
      const item=matches[Number(arg)];if(!item)return;
      if(item.kind==='seller')ctx.openSeller(item.index);
      else if(item.kind==='agenda')ctx.openAgenda(item.index);
      else if(item.kind==='contact')ctx.openAgenda(item.agenda,item.id);
      else ctx.navigate(item.route);
    }
  }
  return {markup,greeting,bind,modalContent,bindModal,handle,openSearch};
}
