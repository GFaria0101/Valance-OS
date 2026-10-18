import {DEMO_DAY,STORE,DEFAULT_FILTERS,buildRecords,filterRecords,sumRecords,groupRecords,growth,percent,number,initialContacts,allocationPreview,shiftYearDate} from './report-data.js';
import {csvText,downloadFile,excelBytes} from './export.js';

export function createFeatures(ctx){
  const {i,money,escapeHtml:e,avatar,btn,title,table,kpi,notify}=ctx;
  const $=selector=>document.querySelector(selector);
  let contacts=JSON.parse(localStorage.getItem('valance-contacts-v1')||'null')||initialContacts(ctx.completed());
  let history=JSON.parse(localStorage.getItem('valance-distributions')||'[]');
  let filters={...DEFAULT_FILTERS},draft={...filters},advanced=false,indicators=false;
  const calendar='364';
  let grouping='agenda',sort={column:0,direction:1},performanceStatus='all',distributionPreview=null;
  let dist={agenda:'all',quantity:10,sellers:[]},dialogKind='ranking';
  const persist=()=>{localStorage.setItem('valance-contacts-v1',JSON.stringify(contacts));localStorage.setItem('valance-distributions',JSON.stringify(history));};
  const users=()=>ctx.users();
  const pct=(n,d)=>d?percent(n/d*100):'—';
  const dateLabel=date=>new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR',{timeZone:'UTC'});
  const windowLabel=()=>`${dateLabel(filters.from)} — ${dateLabel(filters.to)}`;
  const change=(n,p)=>{const value=growth(n,p);return value===null?'<span class="muted">Sem base</span>':`<span class="${value<0?'negative':'positive'}">${value>0?'+':''}${percent(value)}</span>`;};
  const choice=(value,label,current)=>`<option value="${value}" ${String(value)===String(current)?'selected':''}>${e(label)}</option>`;
  const selection=()=>{
    const records=buildRecords(users(),ctx.agendas);
    return {current:filterRecords(records,filters),previous:filterRecords(records,filters,calendar)};
  };
  function aggregates(key){const {current,previous}=selection();return groupRecords(current,previous,key,users(),ctx.agendas);}
  function snapshot(){const {current,previous}=selection();return {current:sumRecords(current),previous:sumRecords(previous)};}
  function getGroup(){return ctx.page()==='by-store'?'store':grouping;}
  function reportColumns(){return [getGroup()==='seller'?'Vendedor':getGroup()==='store'?'Loja':'Agenda','Disponíveis','Realizados disponíveis','% realizado','Gerou total','SSS total','Gerou agenda','SSS agenda','Gerou loja','SSS loja','Gerou vendedor','SSS vendedor','Conversão'];}
  function reportValues(row){return [row.name,row.available,row.done,pct(row.done,row.available),row.revenue,growth(row.revenue,row.previous.revenue),row.revenue*.23,growth(row.revenue*.23,row.previous.revenue*.23),row.revenue*.77,growth(row.revenue*.77,row.previous.revenue*.77),row.revenue*.29,growth(row.revenue*.29,row.previous.revenue*.29),pct(row.orders,row.done+row.extra)];}
  function reportRows(){const rows=aggregates(getGroup());return rows.sort((a,b)=>{const av=reportValues(a)[sort.column],bv=reportValues(b)[sort.column];const n=typeof av==='number'?av-(bv??0):String(av??'').localeCompare(String(bv??''),'pt-BR',{numeric:true});return n*sort.direction;});}
  function filterBar(){return `<form class="card feature-filters" id="report-filters"><div class="filter-fields"><label>De<input type="date" name="from" required value="${draft.from}" aria-label="Data inicial"></label><label>Até<input type="date" name="to" required value="${draft.to}" aria-label="Data final"></label><label>Agenda<select name="agenda">${choice('all','Todas as agendas',draft.agenda)}${ctx.agendas.map((a,n)=>choice(n,a[0],draft.agenda)).join('')}</select></label><div class="filter-buttons"><button type="button" class="btn" data-action="feature-advanced" aria-expanded="${advanced}">${i('list-filter')}Filtros avançados ${i(advanced?'chevron-up':'chevron-down')}</button><button class="btn lime" type="submit">${i('search')}Filtrar</button></div></div>${advanced?`<div class="advanced-fields"><label>Vendedor<select name="seller">${choice('all','Todos os vendedores',draft.seller)}${users().map((u,n)=>choice(n,u[0],draft.seller)).join('')}</select></label>${ctx.page()==='performance'?'':`<label>Canal<select name="channel">${choice('all','Todos os canais',draft.channel)}${choice('store','Loja física',draft.channel)}${choice('digital','Digital',draft.channel)}</select></label><label>Venda mínima (R$)<input type="number" name="minimum" min="0" step="0.01" value="${draft.minimum}"></label>`}<button class="btn text-btn" type="button" data-action="feature-reset-filters">Limpar filtros</button></div>`:''}<p class="error" id="filter-error" role="alert"></p><p class="filter-context">${i('info')} Dados fictícios de outubro de 2026 · ${windowLabel()} · comparativo 364 dias (mesmos dias da semana)</p></form>`;}
  function reportPage(){
    const store=ctx.page()==='by-store',{current:t,previous:p}=snapshot();
    const rows=reportRows(),key=getGroup();
    const body=rows.map(r=>[e(r.name),number(r.available),number(r.done),pct(r.done,r.available),`<b>${money(r.revenue)}</b>`,change(r.revenue,r.previous.revenue),money(r.revenue*.23),change(r.revenue*.23,r.previous.revenue*.23),money(r.revenue*.77),change(r.revenue*.77,r.previous.revenue*.77),money(r.revenue*.29),change(r.revenue*.29,r.previous.revenue*.29),pct(r.orders,r.done+r.extra)]);
    const total=['<b>Total geral</b>',number(t.available),number(t.done),pct(t.done,t.available),`<b>${money(t.revenue)}</b>`,change(t.revenue,p.revenue),money(t.revenue*.23),change(t.revenue*.23,p.revenue*.23),money(t.revenue*.77),change(t.revenue*.77,p.revenue*.77),money(t.revenue*.29),change(t.revenue*.29,p.revenue*.29),pct(t.orders,t.done+t.extra)];
    return title('RELATÓRIOS',store?'Gerou por loja':'Gerou por agenda','Acompanhe os resultados dos relacionamentos, com os filtros da sua operação.',`${btn('Compartilhar resumo','share-2','feature-share-report')}${!store?btn(key==='seller'?'Tabela por agenda':'Tabela por vendedor','users','feature-group'):''}${btn('Salvar Excel','download','feature-excel')}${btn('Baixar CSV','download','feature-csv')}`)+
    `<section class="card"><div class="report-summary feature-summary"><div><span class="eyebrow">GEROU TOTAL</span><strong>${money(t.revenue)}</strong><p>${windowLabel()}</p></div><div class="summary-item"><span>SSS total</span><b>${change(t.revenue,p.revenue)}</b></div><div class="summary-item"><span>% realizado</span><b>${pct(t.done,t.available)}</b></div><div class="summary-item"><span>Total realizados</span><b>${number(t.done+t.extra)}</b></div><div class="summary-item"><span>Disponíveis</span><b>${number(t.available)}</b></div></div><button class="indicator-toggle" data-action="feature-indicators" aria-expanded="${indicators}">Todos os indicadores ${i(indicators?'chevron-up':'chevron-down')}</button>${indicators?`<div class="expanded-metrics"><div><span>Realizados disponíveis</span><b>${number(t.done)}</b></div><div><span>Feito Gotas / extras</span><b>${number(t.extra)}</b></div><div><span>Gerou agenda</span><b>${money(t.revenue*.23)}</b></div><div><span>Gerou loja</span><b>${money(t.revenue*.77)}</b></div><div><span>Gerou vendedor¹</span><b>${money(t.revenue*.29)}</b></div><div><span>Conversão</span><b>${pct(t.orders,t.done+t.extra)}</b></div></div><p class="report-footnote">¹ Receita atribuída ao vendedor; já está incluída no gerou total. SSS compara o resultado com o período equivalente do ano anterior.</p>`:''}</section>${filterBar()}<article class="card report-table">${sortableTable(reportColumns(),body,rows.length?total:null)}${!rows.length?empty():''}<p class="report-footnote">${store?'A demonstração contém uma loja: Reserva Downtown. ':''}${key==='seller'?'Resultados agrupados por vendedor. ':''}Clique nos cabeçalhos para ordenar. Valores de atribuição e comparativos são fictícios.</p></article>`;
  }
  function sortableTable(headers,rows,total){return `<div class="table-scroll"><table><thead><tr>${headers.map((h,n)=>`<th><button class="sort-button" data-action="feature-sort:${n}">${e(h)} ${i(sort.column===n?(sort.direction===1?'chevron-up':'chevron-down'):'arrow-down-up')}</button></th>`).join('')}</tr></thead><tbody>${total?`<tr class="total-row">${total.map(c=>`<td>${c}</td>`).join('')}</tr>`:''}${rows.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
  function empty(){return '<div class="empty">Nenhum resultado para estes filtros. Ajuste o período ou limpe os filtros.</div>';}
  function liveColumns(){return ['Nome','Total','Salão','CDIG','STV','Mala','SSSG','OFF','ON','Proj. em %','Proj. em R$','Last year','Meta'];}
  function liveValues(r,goal){const projected=r.revenue/18*31;return [r.name,r.revenue,r.revenue*.61,r.digital,r.revenue*.1,r.revenue*.06,growth(r.revenue,r.previous.revenue),growth(r.physical,r.previous.physical),growth(r.digital,r.previous.digital),goal?projected/goal*100:null,projected,r.previous.revenue,goal];}
  function liveCells(r,goal){const v=liveValues(r,goal);return [e(r.name),...v.slice(1,6).map(money),change(r.revenue,r.previous.revenue),change(r.physical,r.previous.physical),change(r.digital,r.previous.digital),v[9]===null?'—':percent(v[9]),...v.slice(10).map(money)];}
  function realtimePage(){
    const {current:t,previous:p}=snapshot(),sellers=aggregates('seller').sort((a,b)=>b.revenue-a.revenue),top=sellers[0];
    const total={name:'Total geral',...t,previous:p};
    const comparison=`${dateLabel(shiftYearDate(filters.from,calendar))} — ${dateLabel(shiftYearDate(filters.to,calendar))}`;
    const goalFor=r=>users()[r.id][5]*1.5;
    return title('AO VIVO','Relatório real time','Acompanhamento demonstrativo das vendas e projeções da equipe.',`<span class="tag">${i('calendar-days')}Comparativo de 364 dias</span>`)+
    `<section class="metrics three">${kpi('Meta atingida',pct(t.revenue,75000),'target','Meta da loja',money(75000))}${kpi('Destaque vendas',t.physical>=t.digital?'Salão':'CDIG','chart-column-increasing','Canal destaque','no período selecionado')}<article class="card metric"><div class="metric-label">Vendedor destaque${i('medal')}</div><strong class="seller-highlight">${top?e(top.name.split(' ').slice(0,2).join(' ')):'—'}</strong>${btn('Ranking','trophy','feature-ranking','lime small')}</article></section>${filterBar()}<p class="comparison-note">${i('calendar-clock')} Comparação: ${comparison}. Mesmo dia da semana, 364 dias antes. Projeção mensal ilustrativa: vendas até 18/10 ÷ 18 × 31.</p><article class="card"><div class="card-heading"><h2>Loja</h2>${btn('Compartilhar','share-2','feature-share-report:store')}</div>${table(liveColumns(),[liveCells(total,75000),...aggregates('store').map(r=>liveCells(r,75000))])}</article><article class="card spaced"><div class="card-heading"><h2>Vendedores</h2><div class="actions">${btn('Compartilhar','share-2','feature-share-report:sellers')}${btn('Baixar CSV','download','feature-csv')}</div></div>${table(liveColumns(),[liveCells(total,sellers.reduce((sum,r)=>sum+goalFor(r),0)),...sellers.map(r=>liveCells(r,goalFor(r)))])}${!sellers.length?empty():''}</article><p class="report-footnote">SSSG: crescimento total · OFF: vendas físicas · ON/CDIG: digital · STV: televendas · Mala: relacionamento. Valores simulados, sem atualização automática.</p>`;
  }
  function performanceRows(){
    return users().map((u,seller)=>{
      const rows=contacts.filter(c=>c.seller===seller&&c.date>=filters.from&&c.date<=filters.to&&(filters.agenda==='all'||c.agenda===Number(filters.agenda)));
      const available=rows.filter(c=>c.source==='Preferencial').length,done=rows.filter(c=>c.source==='Preferencial'&&c.done).length,extra=rows.filter(c=>c.source==='Gotas'&&c.done).length;
      return {seller,name:u[0],available,done,extra,total:done+extra,pending:rows.filter(c=>!c.done).length};
    }).filter(r=>(filters.seller==='all'||r.seller===Number(filters.seller))&&(performanceStatus==='all'||(performanceStatus==='pending'?r.pending>0:r.total>0)));
  }
  function performancePage(){
    const rows=performanceRows(),totals=rows.reduce((sum,r)=>{for(const k of ['available','done','extra','total'])sum[k]+=r[k];return sum;},{available:0,done:0,extra:0,total:0});
    const cells=r=>[e(r.name),number(r.available),number(r.done),pct(r.done,r.available),number(r.extra),`<b>${number(r.total)}</b>`];
    return title('RELATÓRIOS','Dedo Duro','Contatos distribuídos e realizados por vendedor, atualizados a cada registro.',`${btn('Compartilhar','share-2','feature-share-report')}${btn('Baixar CSV','download','feature-csv')}`)+filterBar()+`<div class="card filter-bar"><label>Situação<select id="performance-status">${choice('all','Todos os vendedores',performanceStatus)}${choice('pending','Com contatos pendentes',performanceStatus)}${choice('done','Com contatos realizados',performanceStatus)}</select></label><p>Distribua contatos e registre os atendimentos nas agendas para acompanhar os resultados aqui.</p></div><article class="card">${table(['Nome','Disponíveis (Preferencial)','Feito disponível','% realizado','Feito Gotas','Total feitos'],[cells({name:'TOTAL GERAL',...totals}),...rows.map(cells)])}${!rows.length?empty():''}</article><p class="report-footnote">“Disponíveis” inclui os contatos preferenciais atribuídos. “Gotas” são contatos extras. Os totais refletem as ações salvas neste navegador; vendedores sem tarefas aparecem com zero.</p>`;
  }
  function storePage(){
    const {current:t}=snapshot(),sellers=aggregates('seller'),goal=75000,attained=t.revenue/goal*100;
    const days=new Map();for(const r of selection().current)days.set(r.date,(days.get(r.date)||0)+r.revenue);
    const max=Math.max(1,...days.values());
    return title('GESTÃO DA LOJA','Painel da loja','Uma visão da Reserva Downtown: metas, canais, ticket e desempenho da equipe.',`${btn('Salvar Excel','download','feature-excel')}${btn('Compartilhar','share-2','feature-share-report')}`)+filterBar()+
      `<section class="metrics">${kpi('Vendas da loja',money(t.revenue),'store','Período',windowLabel())}${kpi('Ticket médio',t.orders?money(t.revenue/t.orders):'—','shopping-bag','Vendas',number(t.orders)+' pedidos')}${kpi('Peças por atendimento',t.orders?number(t.pieces/t.orders):'—','gem','Volume',number(t.pieces)+' peças')}${kpi('Conversão da loja',pct(t.orders,t.done+t.extra),'chart-no-axes-combined','Relacionamento',number(t.done+t.extra)+' contatos')}</section><section class="two-cols"><article class="card store-goal"><div class="card-heading"><h2>Meta mensal da loja</h2>${i('target')}</div><div class="target-inner"><div class="donut" style="background:conic-gradient(var(--lime) 0 ${Math.min(100,attained)}%,var(--line) ${Math.min(100,attained)}%)"><div><strong>${number(attained)}<small>%</small></strong><span>da meta atingida</span></div></div><div><p>Meta de outubro</p><h2>${money(goal)}</h2><p>Faltam ${money(Math.max(0,goal-t.revenue))}</p></div></div></article><article class="card"><div class="card-heading"><h2>Participação por canal</h2></div><div class="channel-breakdown">${[['Loja física',t.physical],['Digital',t.digital]].map(([name,value])=>`<div><span>${name}<b>${money(value)}</b></span><div class="bar"><span style="width:${t.revenue?value/t.revenue*100:0}%"></span></div><small>${pct(value,t.revenue)} das vendas</small></div>`).join('')}</div></article></section><article class="card"><div class="card-heading"><div><h2>Vendas por dia</h2><p>${windowLabel()}</p></div></div><div class="daily-chart">${[...days].map(([date,value])=>`<div class="daily-bar"><div style="height:${value/max*130}px" title="${dateLabel(date)}: ${money(value)}"></div><span>${date.slice(-2)}</span></div>`).join('')||empty()}</div></article><article class="card spaced"><div class="card-heading"><h2>Desempenho da equipe</h2></div>${table(['Vendedor','Vendas','Pedidos','Ticket médio','Participação'],sellers.map(r=>[e(r.name),money(r.revenue),number(r.orders),r.orders?money(r.revenue/r.orders):'—',pct(r.revenue,t.revenue)]))}${!sellers.length?empty():''}</article>`;
  }
  function agendaPage(){
    const allDone=ctx.agendas.every((_,n)=>contacts.filter(c=>c.agenda===n).every(c=>c.done));
    return title('RELACIONAMENTO','Agendas do dia','Cada contato é uma nova oportunidade de se conectar.',`<span class="tag">${i('calendar-days')}18 de outubro · demonstração</span>`)+
    `<section class="agenda-summary card"><span class="square-icon">${i('calendar-check')}</span><div><h2>${allDone?'Tudo concluído por hoje':'Seu dia começa com boas conexões'}</h2><p>${allDone?'As próximas agendas abrem amanhã, 19/10/2026, a partir das 10:00. Horário de Brasília.':`${contacts.filter(c=>c.done).length} de ${contacts.length} contatos realizados · ${contacts.filter(c=>!c.done).length} aguardando atendimento`}</p></div><span class="tag lime-tag">${pct(contacts.filter(c=>c.done).length,contacts.length)} concluído</span></section><div class="agenda-cards">${ctx.agendas.map((a,n)=>{const rows=contacts.filter(c=>c.agenda===n),left=rows.filter(c=>!c.done).length;return `<article class="card agenda-card"><div class="card-heading"><span class="square-icon tone${n%3}">${i(a[2])}</span><span class="tag ${left?'':'lime-tag'}">${left?a[6]:'Concluída'}</span></div><h2>${a[0]}</h2><p>${a[1]}</p><div class="agenda-count"><strong>${left}</strong><span>${left?'clientes para conversar':'contatos pendentes'}</span></div>${btn(left?'Começar contatos':'Revisar contatos','arrow-right','agenda:'+n,'full '+(left?'lime':''))}</article>`;}).join('')}</div>`;
  }
  function agendaModal(index){
    const a=ctx.agendas[index],rows=contacts.filter(c=>c.agenda===index),pending=rows.filter(c=>!c.done).length;
    return `<span class="square-icon">${i(a[2])}</span><h2>${a[0]}</h2><p>${a[1]} ${pending} contatos pendentes.</p><div class="contact-list">${rows.map(c=>`<div class="contact-row">${avatar([c.name])}<div><b>${e(c.name)}</b><small>${c.seller===null?'Ao registrar: '+e(users()[0][0]):e(users()[c.seller]?.[0]||'Vendedor')} · ${c.source}</small></div><button class="btn small" data-action="feature-contact:${c.id}" ${c.done?'disabled':''}>${i('check')}${c.done?'Registrado':'Registrar'}</button></div>`).join('')}</div><div class="modal-notice">${i('info')} Dados fictícios. Nenhuma mensagem será enviada.</div>${btn(pending?'Registrar todos e concluir':'Agenda concluída','check','complete:'+index,'lime full')}`;
  }
  function distributionPage(){
    const available=contacts.filter(c=>!c.done&&c.seller===null&&(dist.agenda==='all'||c.agenda===Number(dist.agenda)));
    const assigned=contacts.filter(c=>c.seller!==null);
    return title('GESTÃO','Distribuir contatos','Divida os contatos disponíveis igualmente entre os vendedores com acesso ativo.')+
      `<section class="metrics three">${kpi('Sem vendedor',number(contacts.filter(c=>c.seller===null&&!c.done).length),'users','Disponíveis','para distribuir')}${kpi('Contatos atribuídos',number(assigned.length),'user-check','Equipe',number(assigned.filter(c=>!c.done).length)+' pendentes')}${kpi('Contatos realizados',number(contacts.filter(c=>c.done).length),'messages-square','Registrados','nas agendas')}</section><section class="distribution-grid"><form class="card distribution-form" id="distribution-form"><h2>Preparar distribuição</h2><p>Os contatos já atribuídos não serão redistribuídos.</p><label>Agenda<select name="agenda" id="distribution-agenda">${choice('all','Todas as agendas',dist.agenda)}${ctx.agendas.map((a,n)=>choice(n,a[0],dist.agenda)).join('')}</select></label><label>Quantidade de contatos<input name="quantity" type="number" min="1" step="1" max="${available.length}" value="${dist.quantity}" required></label><p class="hint">${available.length} contatos disponíveis nesta seleção.</p><fieldset><legend>Vendedores participantes</legend>${users().map((u,n)=>u[4]?`<label class="seller-check"><input type="checkbox" name="seller" value="${n}" ${dist.sellers.includes(n)?'checked':''}>${avatar(u,n)}<span>${e(u[0])}</span></label>`:'').join('')||'<p>Nenhum acesso ativo. Ative um vendedor na gestão de usuários.</p>'}</fieldset><p class="error" id="distribution-error" role="alert"></p><button class="btn lime full" type="submit" ${available.length?'':'disabled'}>Pré-visualizar distribuição ${i('arrow-right')}</button></form><article class="card distribution-result"><div class="card-heading"><div><h2>Prévia da distribuição</h2><p>Confira antes de confirmar.</p></div></div>${distributionPreview?`${table(['Vendedor','Contatos'],dist.sellers.map(s=>[e(users()[s][0]),distributionPreview.filter(r=>r.seller===s).length]))}<div class="distribution-confirm"><p>${distributionPreview.length} contatos serão atribuídos. A ação será salva somente neste navegador.</p>${btn('Confirmar distribuição','check','feature-distribute','lime full')}</div>`:'<div class="empty">Selecione a agenda, a quantidade e os vendedores para visualizar a divisão.</div>'}</article></section><article class="card spaced"><div class="card-heading"><h2>Histórico de distribuições</h2></div>${history.length?table(['Data','Agenda','Quantidade','Vendedores'],history.slice().reverse().map(h=>[e(h.when),e(h.agenda),h.quantity,e(h.sellers)])):'<div class="empty">Nenhuma distribuição realizada ainda.</div>'}</article><article class="card spaced"><div class="card-heading"><h2>Contatos por vendedor</h2></div>${table(['Vendedor','Atribuídos','Realizados','Pendentes'],users().map((u,s)=>{const list=contacts.filter(c=>c.seller===s);return [e(u[0]),list.length,list.filter(c=>c.done).length,list.filter(c=>!c.done).length];}))}</article>`;
  }
  function readDraft(){const form=$('#report-filters');if(!form)return;const data=new FormData(form);for(const key of Object.keys(draft))if(data.has(key))draft[key]=data.get(key);}
  function bind(){
    const form=$('#report-filters');if(form){form.oninput=readDraft;form.onsubmit=event=>{event.preventDefault();readDraft();if(draft.from>draft.to){$('#filter-error').textContent='A data inicial deve ser anterior ou igual à data final.';return;}filters={...draft};ctx.render();};}
    if($('#performance-status'))$('#performance-status').onchange=event=>{performanceStatus=event.target.value;ctx.render();};
    const distribution=$('#distribution-form');if(distribution){
      const readDistribution=()=>{const data=new FormData(distribution);dist={agenda:data.get('agenda'),quantity:Number(data.get('quantity')),sellers:data.getAll('seller').map(Number)};};
      distribution.onchange=event=>{readDistribution();distributionPreview=null;if(event.target.name==='agenda')ctx.render();else {const result=$('.distribution-result');if(result)result.innerHTML='<div class="empty">A seleção mudou. Gere uma nova prévia para confirmar.</div>';}};
      distribution.onsubmit=event=>{event.preventDefault();readDistribution();try{distributionPreview=allocationPreview(contacts,dist.agenda,dist.quantity,dist.sellers);ctx.render();}catch(error){$('#distribution-error').textContent=error.message;}};
    }
  }
  function exportRows(){return rawExportRows().map(row=>row.map(value=>typeof value==='number'?Math.round(value*100)/100:value));}
  function rawExportRows(){
    const page=ctx.page();if(page==='generated'||page==='by-store'){
      const {current,previous}=snapshot();const list=[{name:'TOTAL GERAL',...current,previous},...reportRows()];
      return [reportColumns(),...list.map(r=>reportValues(r).map(v=>v===null?'Sem base':v))];
    }
    if(page==='performance')return [['Vendedor','Disponíveis (Preferencial)','Feito disponível','% realizado','Feito Gotas','Total feitos'],...performanceRows().map(r=>[r.name,r.available,r.done,r.available?r.done/r.available*100:0,r.extra,r.total])];
    if(page==='users')return [['Nome','Perfil','Cupom','Acesso'],...visibleUsers().map(u=>[u[0],u[1],u[3],u[4]?'Ativo':'Inativo'])];
    if(page==='realtime'){const list=aggregates('seller'),{current,previous}=snapshot();return [liveColumns(),liveValues({name:'TOTAL GERAL',...current,previous},list.reduce((sum,r)=>sum+users()[r.id][5]*1.5,0)),...list.map(r=>liveValues(r,users()[r.id][5]*1.5))];}
    return [['Vendedor','Vendas','Pedidos','Ticket médio','Participação'],...aggregates('seller').map(r=>[r.name,r.revenue,r.orders,r.orders?r.revenue/r.orders:0,snapshot().current.revenue?r.revenue/snapshot().current.revenue*100:0])];
  }
  function visibleUsers(){return users().filter(u=>(u[0]+' '+u[2]+' '+u[1]).toLowerCase().includes(ctx.query().toLowerCase())&&(ctx.userFilter()==='all'||u[4]===(ctx.userFilter()==='active')));}
  function userSummary(){const list=visibleUsers();return `Valance OS · Equipe demonstrativa\n${list.length} vendedores\n`+list.map(u=>`${u[0]} · @${u[1]} · Cupom ${u[3]} · ${u[4]?'Ativo':'Inativo'}`).join('\n');}
  function accessSummary(){const u=ctx.accessUser();return `Valance OS · Acesso de demonstração\nVendedor: ${u[0]}\nLogin (CPF fictício): ${u[2]}\nSenha demonstrativa: ${ctx.password()}\nDados fictícios, sem acesso a sistemas reais.`;}
  function openDialog(kind){dialogKind=kind;ctx.openModal('feature');}
  function modalContent(){
    if(dialogKind==='ranking'){
      const ranked=aggregates('seller').sort((a,b)=>b.revenue-a.revenue);
      return `<span class="square-icon">${i('trophy')}</span><h2>Ranking de vendedores</h2><p>${windowLabel()} · valores fictícios</p>${table(['Posição','Vendedor','Vendas'],ranked.map((r,n)=>[n+1,e(r.name),money(r.revenue)]))}${!ranked.length?empty():''}`;
    }
    if(dialogKind==='shareusers')return `<span class="square-icon">${i('share-2')}</span><h2>Compartilhar lista de vendedores</h2><p>A lista respeita a busca e o filtro de acesso. CPF e senhas não são incluídos.</p><pre class="share-preview">${e(userSummary())}</pre><div class="modal-action-grid">${btn('Copiar lista','copy','feature-copy-users','lime')}${btn('Baixar CSV','download','feature-csv')}${btn('Compartilhar','share-2','feature-native-share')}</div>`;
    return `<span class="square-icon">${i('message-circle')}</span><h2>Enviar pelo WhatsApp</h2><p>Confira o acesso fictício. O WhatsApp abrirá para você escolher o destinatário e confirmar o envio.</p><pre class="share-preview">${e(accessSummary())}</pre>${btn('Abrir WhatsApp','arrow-up-right','feature-launch-whatsapp','lime full')}<p class="hint">Nenhuma mensagem é enviada automaticamente. Este acesso é apenas demonstrativo.</p>`;
  }
  async function handle(action,arg){
    if(!action.startsWith('feature-'))return false;
    if(action==='feature-advanced'){readDraft();advanced=!advanced;ctx.render();}
    else if(action==='feature-reset-filters'){filters={...DEFAULT_FILTERS};draft={...filters};ctx.render();}
    else if(action==='feature-indicators'){indicators=!indicators;ctx.render();}
    else if(action==='feature-group'){grouping=grouping==='agenda'?'seller':'agenda';sort={column:0,direction:1};ctx.render();}
    else if(action==='feature-sort'){const column=Number(arg);sort={column,direction:sort.column===column?-sort.direction:1};ctx.render();}
    else if(action==='feature-ranking')openDialog('ranking');
    else if(action==='feature-contact'){
      const contact=contacts.find(c=>c.id===arg);if(contact&&!contact.done){contact.done=true;if(contact.seller===null)contact.seller=0;persist();if(contacts.filter(c=>c.agenda===contact.agenda).every(c=>c.done))ctx.markAgendaDone(contact.agenda);ctx.renderModal();notify('Contato registrado. O Dedo Duro foi atualizado.');}
    }
    else if(action==='feature-distribute'){
      try{
        if(!distributionPreview)throw new Error('Gere uma prévia antes de confirmar.');
        if(dist.sellers.some(s=>!users()[s]?.[4]))throw new Error('Um vendedor está sem acesso. Selecione vendedores ativos e gere outra prévia.');
        const fresh=allocationPreview(contacts,dist.agenda,dist.quantity,dist.sellers);
        if(JSON.stringify(fresh)!==JSON.stringify(distributionPreview))throw new Error('Os contatos disponíveis mudaram. Gere uma nova prévia.');
        for(const row of fresh)contacts.find(c=>c.id===row.id).seller=row.seller;
        history.push({when:new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),agenda:dist.agenda==='all'?'Todas as agendas':ctx.agendas[Number(dist.agenda)][0],quantity:fresh.length,sellers:dist.sellers.map(s=>users()[s][0]).join(', ')});
        distributionPreview=null;persist();ctx.render();notify('Contatos distribuídos com sucesso.');
      }catch(error){notify(error.message);distributionPreview=null;ctx.render();}
    }
    else if(action==='feature-excel'){downloadFile(excelBytes(exportRows()),`valance-${ctx.page()}.xlsx`,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');notify('Planilha Excel exportada com os filtros atuais.');}
    else if(action==='feature-csv'){downloadFile(csvText(exportRows()),`valance-${ctx.page()}.csv`,'text/csv;charset=utf-8');notify('CSV exportado com os filtros atuais.');}
    else if(action==='feature-share-report'){
      let rows=exportRows();if(ctx.page()==='realtime'&&arg==='store'){const {current,previous}=snapshot();rows=[liveColumns(),liveValues({name:STORE,...current,previous},75000)].map(row=>row.map(v=>typeof v==='number'?Math.round(v*100)/100:v));}await ctx.copy(`Valance OS · ${ctx.page()} · Dados fictícios\n${windowLabel()}\n${rows.map(row=>row.map(v=>typeof v==='number'?number(v):v??'Sem base').join(' | ')).join('\n')}`);
    }
    else if(action==='feature-share-users')openDialog('shareusers');
    else if(action==='feature-copy-users')await ctx.copy(userSummary());
    else if(action==='feature-native-share'){
      try{if(navigator.share)await navigator.share({title:'Equipe Valance OS',text:userSummary()});else await ctx.copy(userSummary());}catch(error){if(error.name!=='AbortError')notify('Não foi possível compartilhar. Use Copiar lista ou Baixar CSV.');}
    }
    else if(action==='feature-whatsapp')openDialog('whatsapp');
    else if(action==='feature-launch-whatsapp')window.open(`https://wa.me/?text=${encodeURIComponent(accessSummary())}`,'_blank','noopener,noreferrer');
    return true;
  }
  function completeAgenda(index){for(const c of contacts)if(c.agenda===index){c.done=true;if(c.seller===null)c.seller=0;}persist();}
  return {reportPage,realtimePage,performancePage,storePage,agendaPage,agendaModal,distributionPage,bind,handle,modalContent,completeAgenda,
    searchContacts:()=>contacts.map(c=>({kind:'contact',id:c.id,agenda:c.agenda,name:c.name,detail:`Contato · ${ctx.agendas[c.agenda][0]}`,terms:`${c.source} ${c.done?'realizado':'pendente'} ${c.seller===null?'sem vendedor':users()[c.seller]?.[0]||''}`}))};
}
