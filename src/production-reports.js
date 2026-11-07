const DASH = '—';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const list = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object') : [];
const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null;
const sum = values => values.length && values.every(value => numeric(value) !== null) ? values.reduce((total, value) => total + Number(value), 0) : null;
const ratio = (value, denominator) => numeric(value) !== null && numeric(denominator) > 0 ? Number(value) / Number(denominator) * 100 : null;
const growth = (value, previous) => numeric(value) !== null && numeric(previous) > 0 ? (Number(value) - Number(previous)) / Number(previous) * 100 : null;
const raw = value => numeric(value) ?? DASH;
const number = value => numeric(value) === null ? DASH : Number(value).toLocaleString('pt-BR', {maximumFractionDigits:2});
const money = value => numeric(value) === null ? DASH : Number(value).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
const percent = value => numeric(value) === null ? DASH : `${Number(value).toLocaleString('pt-BR', {maximumFractionDigits:1})}%`;
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value).split('-').reverse().join('/') : DASH;
const column = (label, format = 'number') => ({label, format});
const text = label => column(label, 'text');
const cash = label => column(label, 'money');
const percentage = label => column(label, 'percent');
const button = (label, action, extra = '') => `<button type="button" class="btn ${escape(extra)}" data-action="${escape(action)}">${escape(label)}</button>`;
const metric = (label, value, description = '') => `<article class="card metric"><div class="metric-label">${escape(label)}</div><strong>${escape(value)}</strong><p>${escape(description)}</p></article>`;
const actions = ({ranking = false} = {}) => `<div class="actions">${ranking ? button('Ranking','ranking') : ''}${button('Compartilhar resumo','share-report')}${button('Salvar Excel','excel')}${button('Baixar CSV','csv')}</div>`;

function dataset(key, title, columns, rows, {total = false} = {}) {
  return {key,title,columns,headers:columns.map(c => c.label),rows,total};
}

function table(data) {
  const format = (value, type) => escape(type === 'money' ? money(value) : type === 'percent' ? percent(value) : type === 'number' ? number(value) : value ?? DASH);
  return `<div class="table-scroll"><table class="report-table production-report-table"><caption class="production-report-caption">${escape(data.title)}</caption><thead><tr>${data.headers.map(label => `<th scope="col">${escape(label)}</th>`).join('')}</tr></thead><tbody>${data.rows.map((row,index) => `<tr${data.total && index === 0 ? ' class="total-row"' : ''}>${row.map((value,n) => n === 0 ? `<th scope="row">${format(value,data.columns[n].format)}</th>` : `<td>${format(value,data.columns[n].format)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${data.rows.length ? '' : '<div class="empty">Nenhum registro para esta consulta.</div>'}`;
}

function panel(title, body, tools = '', note = '') {
  return `<article class="card production-report-section"><div class="card-heading"><h2>${escape(title)}</h2>${tools}</div>${body}${note ? `<p class="report-footnote">${escape(note)}</p>` : ''}</article>`;
}

function storeId(selectedStore) {
  return typeof selectedStore === 'object' && selectedStore ? selectedStore.id : selectedStore;
}

function targetAmount(snapshot, {profile,selectedStore,sellerId,storeOnly = false} = {}) {
  const filters = snapshot.filters || {};
  const id = storeId(selectedStore) || filters.store_id;
  const seller = storeOnly ? null : sellerId || filters.seller_id || (profile?.role === 'seller' ? profile.id : null);
  const matches = list(snapshot.targets).filter(row => (!id || row.store_id === id) && (seller ? row.seller_id === seller : !row.seller_id));
  return sum(matches.map(row => row.amount));
}

function targetForRow(snapshot, row, kind) {
  return targetAmount(snapshot, kind === 'seller' ? {sellerId:row.seller_id,selectedStore:row.store_id} : {selectedStore:row.store_id,storeOnly:true});
}

function previousForStore(snapshot, row) {
  if (numeric(row.previous_gross) !== null) return Number(row.previous_gross);
  // Older snapshots expose a single scoped comparison only in totals.
  return list(snapshot.by_store).length === 1 ? numeric(snapshot.totals?.previous_gross) : null;
}

function generatedTables(snapshot) {
  const rows = list(snapshot.by_agenda);
  const columns = [text('Agenda'),column('Disponíveis'),column('Realizados'),percentage('% realizado'),cash('Gerou total (atribuído)'),percentage('SSS total (364 dias)'),cash('Gerou agenda (origem)'),percentage('SSS agenda'),cash('Gerou loja (origem)'),percentage('SSS loja'),cash('Gerou vendedor (origem)'),percentage('SSS vendedor')];
  const rowValues = row => [row.name || 'Agenda',raw(row.contacts_available),raw(row.contacts_completed),raw(ratio(row.contacts_completed,row.contacts_available)),raw(row.gross),raw(growth(row.gross,row.previous_gross)),raw(row.agenda_gross),raw(growth(row.agenda_gross,row.agenda_previous_gross)),raw(row.store_gross),raw(growth(row.store_gross,row.store_previous_gross)),raw(row.seller_gross),raw(growth(row.seller_gross,row.seller_previous_gross))];
  const total = {name:'TOTAL GERAL',contacts_available:sum(rows.map(r => r.contacts_available)),contacts_completed:sum(rows.map(r => r.contacts_completed)),gross:numeric(snapshot.totals?.attributed_gross) ?? sum(rows.map(r => r.gross)),previous_gross:sum(rows.map(r => r.previous_gross))};
  for (const key of ['agenda_gross','agenda_previous_gross','store_gross','store_previous_gross','seller_gross','seller_previous_gross']) total[key] = sum(rows.map(r => r[key]));
  const detailColumns = label => [text('Agenda'),text(label),cash('Receita atribuída'),cash('Mesmo período (364 dias)'),percentage('SSS (364 dias)')];
  const details = (key, name) => rows.flatMap(agenda => list(agenda[key]).map(row => [agenda.name || 'Agenda',row.name || name,raw(row.gross),raw(row.previous_gross),raw(growth(row.gross,row.previous_gross))]));
  return [dataset('agendas','Gerou por agenda',columns,rows.length ? [rowValues(total),...rows.map(rowValues)] : [],{total:true}),dataset('agenda-sellers','Resultados atribuídos por vendedor',detailColumns('Vendedor'),details('by_seller','Vendedor')),dataset('agenda-stores','Resultados atribuídos por loja',detailColumns('Loja'),details('by_store','Loja'))];
}

function storeTable(snapshot) {
  const rows = list(snapshot.by_store);
  const rowValues = row => [row.name || 'Loja',raw(row.gross),raw(row.returns),raw(row.orders),raw(numeric(row.orders) > 0 && numeric(row.gross) !== null ? Number(row.gross) / Number(row.orders) : null),raw(previousForStore(snapshot,row)),raw(growth(row.gross,previousForStore(snapshot,row))),raw(targetForRow(snapshot,row,'store'))];
  const total = {name:'TOTAL GERAL',gross:snapshot.totals?.gross,returns:snapshot.totals?.returns,orders:snapshot.totals?.orders,previous_gross:snapshot.totals?.previous_gross};
  const totalValues = [...rowValues(total)];
  totalValues[7] = raw(sum(rows.map(row => targetForRow(snapshot,row,'store'))));
  return dataset('stores','Gerou por loja',[text('Loja'),cash('Vendas brutas'),cash('Devoluções'),column('Pedidos'),cash('Ticket médio'),cash('Mesmo período (364 dias)'),percentage('SSS (364 dias)'),cash('Meta mensal cadastrada')],rows.length ? [totalValues,...rows.map(rowValues)] : [],{total:true});
}

function performanceTable(snapshot) {
  const rows = list(snapshot.by_seller);
  const rowValues = row => [row.name || 'Vendedor',raw(row.available_preferencial),raw(row.completed_preferencial),raw(ratio(row.completed_preferencial,row.available_preferencial)),raw(row.completed_gotas),raw(sum([row.completed_preferencial,row.completed_gotas]))];
  const total = {name:'TOTAL GERAL'};
  for (const key of ['available_preferencial','completed_preferencial','completed_gotas']) total[key] = sum(rows.map(row => row[key]));
  return dataset('performance','Dedo Duro',[text('Vendedor'),column('Disponíveis (Preferencial)'),column('Feito disponível'),percentage('% realizado'),column('Feito Gotas'),column('Total feitos')],rows.length ? [rowValues(total),...rows.map(rowValues)] : [],{total:true});
}

function realtimeTables(snapshot) {
  const columns = [text('Nome'),cash('Total'),cash('Salão'),cash('CDIG'),cash('STV'),cash('Mala'),percentage('SSSG (364 dias)'),percentage('OFF'),percentage('ON'),percentage('Proj. em %'),cash('Proj. em R$'),cash('Last year (364 dias)'),cash('Meta mensal')];
  const create = (key,title,rows,kind) => {
    const previous = row => kind === 'store' ? previousForStore(snapshot,row) : numeric(row.previous_gross);
    const rowValues = row => [row.name || title,raw(row.gross),raw(row.salon_gross),raw(row.cdig_gross),raw(row.stv_gross),raw(row.mala_gross),raw(growth(row.gross,previous(row))),raw(row.off_growth),raw(row.on_growth),raw(row.projected_percent),raw(row.projected_gross),raw(previous(row)),raw(targetForRow(snapshot,row,kind))];
    const total = {name:'TOTAL',gross:sum(rows.map(row => row.gross)),previous_gross:sum(rows.map(previous))};
    for (const key of ['salon_gross','cdig_gross','stv_gross','mala_gross']) total[key] = sum(rows.map(row => row[key]));
    const totalValues = rowValues(total);
    totalValues[12] = raw(sum(rows.map(row => targetForRow(snapshot,row,kind))));
    return dataset(key,title,columns,rows.length ? [totalValues,...rows.map(rowValues)] : [],{total:true});
  };
  return [create('realtime-stores','Loja',list(snapshot.by_store),'store'),create('realtime-sellers','Vendedores',list(snapshot.by_seller),'seller')];
}

function dailyTable(snapshot) {
  return dataset('daily','Vendas por dia',[text('Data'),cash('Vendas brutas'),cash('Devoluções'),column('Pedidos')],list(snapshot.by_day).map(row => [date(row.date),raw(row.gross),raw(row.returns),raw(row.orders)]));
}

function sellersTable(snapshot) {
  return dataset('sellers','Resultados da equipe',[text('Vendedor'),cash('Vendas brutas'),cash('Devoluções'),column('Pedidos'),cash('Mesmo período (364 dias)'),percentage('SSS (364 dias)'),column('Contatos realizados')],list(snapshot.by_seller).map(row => [row.name || 'Vendedor',raw(row.gross),raw(row.returns),raw(row.orders),raw(row.previous_gross),raw(growth(row.gross,row.previous_gross)),raw(row.contacts_completed)]));
}

/** Export matrices contain numeric values, not formatted currency or invented zeros. */
export function reportTableData(route, snapshot = {}) {
  snapshot = snapshot || {};
  let tables;
  if (route === 'generated') tables = generatedTables(snapshot);
  else if (route === 'by-store') tables = [storeTable(snapshot)];
  else if (route === 'performance') tables = [performanceTable(snapshot)];
  else if (route === 'realtime') {
    tables = realtimeTables(snapshot);
    return {headers:['Tipo',...tables[0].headers],rows:tables.flatMap(t => t.rows.map(row => [t.title,...row])),tables};
  } else if (route === 'store') tables = [storeTable(snapshot),sellersTable(snapshot),dailyTable(snapshot)];
  else tables = [dailyTable(snapshot),sellersTable(snapshot)];
  return {headers:tables[0].headers,rows:tables[0].rows,tables};
}

function indicators(snapshot) {
  const totals = snapshot.totals || {};
  const items = [['Vendas brutas no escopo',money(totals.gross)],['Receita atribuída às agendas',money(totals.attributed_gross)],['Clientes contatados',number(totals.customers_contacted)],['Clientes convertidos',number(totals.converted_customers)],['Conversão em até 15 dias',percent(totals.conversion)],['Devoluções acumuladas',money(totals.returns)],['Mesmo período (364 dias)',money(totals.previous_gross)],['SSS total (364 dias)',percent(growth(totals.gross,totals.previous_gross))]];
  return `<details class="card production-panel production-indicators"><summary>Todos os indicadores</summary><div class="expanded-metrics">${items.map(([label,value]) => `<div><span>${escape(label)}</span><b>${escape(value)}</b></div>`).join('')}</div></details>`;
}

function goal(snapshot, context) {
  const amount = targetAmount(snapshot,context);
  const filteredAgenda = Boolean(snapshot.filters?.agenda_id);
  const attained = filteredAgenda ? null : ratio(snapshot.totals?.gross,amount);
  const label = context.profile?.role === 'seller' ? 'Minha meta' : 'Meta de vendas';
  return `<article class="card target-card production-goal"><div class="card-heading"><h2>${label}</h2><span class="tag">${escape(date(context.from))} – ${escape(date(context.to))}</span></div><div class="production-goal-values"><strong>${escape(percent(attained))}</strong><div><b>${escape(money(snapshot.totals?.gross))}</b><p>${amount === null ? 'Nenhuma meta cadastrada para este escopo.' : `Meta mensal cadastrada: ${escape(money(amount))}`}</p></div></div>${attained === null ? '' : `<progress max="100" value="${Math.max(0,Math.min(100,attained))}" aria-label="Percentual da meta atingida">${escape(percent(attained))}</progress>`}<p class="target-note">${filteredAgenda ? 'A meta mensal não é dividida por agenda; o percentual fica indisponível neste filtro.' : 'As metas mensais cadastradas para o período são somadas, sem rateio por dia.'}</p></article>`;
}

const attributionNote = 'Vendas brutas antes dos descontos; devoluções acumuladas aparecem separadamente. Atribuição ao último atendimento válido antes da compra, em até 15 dias. Conversões recentes ainda podem mudar.';
const comparisonNote = 'Comparativo com o mesmo intervalo deslocado em 364 dias. SSS sem base anterior positiva aparece como “—”.';
const sourceNote = 'Dados atuais vêm das importações do PDV. A integração automática com o Presence e o mapeamento de canais ainda estão pendentes. Campos não informados aparecem como “—”.';

function overview(snapshot, context) {
  const t = snapshot.totals || {};
  const pending = numeric(t.contacts_available) !== null && numeric(t.contacts_completed) !== null ? Math.max(0,Number(t.contacts_available)-Number(t.contacts_completed)) : null;
  const agendaRows = list(snapshot.by_agenda).map(row => [row.name || 'Agenda',raw(row.contacts_available),raw(row.contacts_completed),raw(ratio(row.contacts_completed,row.contacts_available))]);
  const agendaData = dataset('agenda-summary','Resumo das agendas',[text('Agenda'),column('Disponíveis'),column('Realizados'),percentage('% realizado')],agendaRows);
  return `<section class="card production-panel production-report-intro"><span class="eyebrow">SUA OPERAÇÃO</span><h2>Relacionamento e resultados em um só lugar</h2><p>Acompanhe os contatos, organize os próximos atendimentos e consulte os resultados do período selecionado.</p><div class="actions">${button('Abrir agendas','nav:agendas','lime')}${button('Consultar clientes','nav:customers')}${button('Ver painel de vendas','nav:sales')}</div></section><section class="metrics">${metric('Contatos pendentes',number(pending),'Tarefas disponíveis menos concluídas no período')}${metric('Atendimentos realizados',number(t.contacts_completed),'Registros confirmados pela equipe')}${metric('Pedidos',number(t.orders),'Vendas concluídas importadas')}${metric('Vendas brutas',money(t.gross),'No escopo dos filtros atuais')}</section><section class="two-cols">${panel('Resumo das agendas',table(agendaData))}${panel('Última importação',`<div class="production-report-copy"><p>${snapshot.latest_sync ? `Situação: <b>${escape(snapshot.latest_sync.status)}</b>` : 'Nenhuma importação registrada.'}</p>${snapshot.latest_sync?.started_at ? `<p>Início: ${escape(new Date(snapshot.latest_sync.started_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}))} · Brasília</p>` : ''}<p>${escape(sourceNote)}</p></div>`,context.profile?.role === 'seller' ? '' : button('Importar dados','nav:imports'))}</section>`;
}

function sales(snapshot, context) {
  const t = snapshot.totals || {};
  const todayGrowth = growth(t.today_gross,t.yesterday_gross);
  const data = reportTableData('sales',snapshot);
  return `<section class="sales-grid">${goal(snapshot,context)}<div class="metrics sales-metrics">${metric('Vendi hoje',money(t.today_gross),todayGrowth === null ? 'Comparação com ontem indisponível' : `${percent(todayGrowth)} em relação a ontem`)}${metric('No período',money(t.gross),'Vendas brutas no escopo dos filtros')}${metric('Mesmo período (364 dias)',money(t.previous_gross),comparisonNote)}${metric('Conversão',percent(t.conversion),'Clientes contatados que compraram em até 15 dias')}</div></section>${panel('Vendas por dia',table(data.tables[0]),actions(),attributionNote)}${panel('Resultados da equipe',table(data.tables[1]),button('Ranking','ranking'),comparisonNote)}`;
}

function store(snapshot, context) {
  const t = snapshot.totals || {};
  const data = reportTableData('store',snapshot);
  const amount = targetAmount(snapshot,{...context,storeOnly:true});
  const storeName = list(snapshot.stores).find(row => row.id === storeId(context.selectedStore))?.name || (list(snapshot.by_store).length === 1 ? snapshot.by_store[0].name : 'Quiosques autorizados');
  return `<section class="card production-panel production-report-intro"><span class="eyebrow">GESTÃO DO QUIOSQUE</span><h2>${escape(storeName)}</h2><p>Resultado consolidado da loja, metas cadastradas e participação da equipe no período selecionado.</p><div class="actions">${button('Definir meta','target')}${button('Distribuir contatos','nav:distribution')}</div></section><section class="metrics">${metric('Vendas brutas da loja',money(t.gross),'No escopo dos filtros atuais')}${metric('Meta mensal da loja',money(amount),'Metas de vendedores não são somadas à meta da loja')}${metric('Ticket médio',numeric(t.orders) > 0 && numeric(t.gross) !== null ? money(Number(t.gross)/Number(t.orders)) : DASH,'Vendas brutas divididas pelos pedidos')}${metric('SSS (364 dias)',percent(growth(t.gross,t.previous_gross)),'Variação sobre a base anterior positiva')}</section>${panel('Consolidado por loja',table(data.tables[0]),actions(),comparisonNote)}<section class="two-cols">${panel('Participação da equipe',table(data.tables[1]),button('Ranking','ranking'),'Vendas sem vendedor identificado constam no total da loja e não são atribuídas a um funcionário.')}${panel('Movimento diário da loja',table(data.tables[2]))}</section>`;
}

function generated(snapshot) {
  const t = snapshot.totals || {};
  const data = reportTableData('generated',snapshot);
  return `<section class="metrics three">${metric('Receita atribuída às agendas',money(t.attributed_gross),'Vendas vinculadas a um atendimento válido')}${metric('Atendimentos realizados',number(t.contacts_completed),'Concluídos no período selecionado')}${metric('Conversão',percent(t.conversion),'Clientes contatados que compraram em até 15 dias')}</section>${indicators(snapshot)}${panel('Gerou por agenda',table(data.tables[0]),actions(),'Gerou total representa receita atribuída à agenda. A divisão por origem agenda/loja/vendedor depende de campos ainda não fornecidos pelo PDV; ela não é inferida dos totais.')}${panel('Resultados atribuídos por vendedor',table(data.tables[1]),'', 'Mostra o vendedor que registrou a venda atribuída a cada agenda, conforme os dados importados.')}${panel('Resultados atribuídos por loja',table(data.tables[2]),'',comparisonNote)}<p class="comparison-note">${escape(attributionNote)}</p>`;
}

function realtime(snapshot, context) {
  const t = snapshot.totals || {};
  const data = reportTableData('realtime',snapshot);
  const leader = [...list(snapshot.by_seller)].filter(row => numeric(row.gross) > 0).sort((a,b) => Number(b.gross)-Number(a.gross))[0];
  const amount = targetAmount(snapshot,context);
  return `<section class="card production-panel production-report-intro"><span class="eyebrow">ACOMPANHAMENTO</span><h2>Relatório Real Time</h2><p>As alterações confirmadas no banco aparecem para os usuários conectados. As vendas do PDV acompanham a última importação.</p><span class="tag">Comparativo de 364 dias</span></section><section class="metrics three">${metric('Meta atingida',percent(snapshot.filters?.agenda_id ? null : ratio(t.gross,amount)),amount === null ? 'Meta ainda não cadastrada neste escopo' : `Meta mensal: ${money(amount)}`)}${metric('Destaque de vendas por canal',DASH,'Salão, CDIG, STV e Mala aguardam mapeamento do PDV')}${metric('Vendedor destaque',leader?.name || DASH,leader ? money(leader.gross) : 'Nenhuma venda identificada para destaque')}</section><div class="production-report-tools">${button('Ranking','ranking','lime')}</div><p class="comparison-note">${escape(sourceNote)}</p>${data.tables.map(item => panel(item.title,table(item),button('Compartilhar','share-report'),`${comparisonNote} Projeções e variações OFF/ON não são calculadas sem sua fonte e regra de cálculo.`)).join('')}<div class="production-report-tools">${actions()}</div>`;
}

/** Pure HTML renderer. All data and labels from the snapshot are escaped. */
export function renderReportPage({route,snapshot = {},profile = {},selectedStore,from,to} = {}) {
  snapshot = snapshot || {};
  const context = {profile:profile || {},selectedStore,from,to};
  let body;
  if (route === 'overview') body = overview(snapshot,context);
  else if (route === 'sales') body = sales(snapshot,context);
  else if (route === 'store') body = store(snapshot,context);
  else if (route === 'generated') body = generated(snapshot);
  else if (route === 'realtime') body = realtime(snapshot,context);
  else if (route === 'by-store') body = `${indicators(snapshot)}${panel('Gerou por loja',table(reportTableData(route,snapshot).tables[0]),actions(),`${comparisonNote} ${attributionNote}`)}`;
  else if (route === 'performance') body = `${panel('Dedo Duro',table(reportTableData(route,snapshot).tables[0]),actions(),'Realização considera tarefas Preferenciais; Feito Gotas é apresentado separadamente. Total feitos soma essas duas origens, sem contar vendas.')}`;
  else return '';
  return `<div class="production-report-page" data-report-route="${escape(route)}">${body}</div>`;
}
