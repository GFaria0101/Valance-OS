import test from 'node:test';
import assert from 'node:assert/strict';
import {reportTableData,renderReportPage} from '../src/production-reports.js';

const fixture = () => ({
  filters:{store_id:'store-a',seller_id:null,agenda_id:null},
  totals:{gross:1200,returns:120,orders:4,previous_gross:800,today_gross:300,yesterday_gross:200,contacts_available:10,contacts_completed:8,customers_contacted:6,converted_customers:3,conversion:50,attributed_gross:700},
  stores:[{id:'store-a',name:'Quiosque A'}],
  profiles:[{id:'seller-a',role:'seller',store_id:'store-a',name:'Ana'}],
  by_store:[{store_id:'store-a',name:'Quiosque A',gross:1200,returns:120,orders:4,previous_gross:800}],
  by_seller:[{seller_id:'seller-a',name:'Ana',gross:1000,returns:100,orders:3,previous_gross:500,contacts_available:6,contacts_completed:5,available_preferencial:6,completed_preferencial:5,completed_gotas:2}],
  by_day:[{date:'2026-11-01',gross:1200,returns:120,orders:4}],
  by_agenda:[{agenda_id:'agenda-a',name:'Pós-venda',gross:700,previous_gross:350,orders:2,contacts_available:10,contacts_completed:8,by_seller:[{seller_id:'seller-a',name:'Ana',gross:700,previous_gross:350}],by_store:[{store_id:'store-a',name:'Quiosque A',gross:700,previous_gross:350}]}],
  targets:[{store_id:'store-a',seller_id:null,amount:2000},{store_id:'store-a',seller_id:'seller-a',amount:1500},{store_id:'store-b',seller_id:null,amount:9000}]
});
const render = (route,snapshot = fixture(),extra = {}) => renderReportPage({route,snapshot,profile:{id:'manager-a',role:'manager'},selectedStore:'store-a',from:'2026-11-01',to:'2026-11-07',...extra});

test('missing metrics remain unavailable, including when counts exist, while imported zero stays zero', () => {
  const missing = {by_store:[{store_id:'store-a',name:'A',orders:2,gross:null}],by_seller:[{name:'Ana',gross:0,orders:0,previous_gross:0}],totals:{conversion:null}};
  const stores = reportTableData('by-store',missing);
  assert.equal(stores.rows[1][1],'—');
  assert.equal(stores.rows[1][4],'—','missing revenue cannot become a zero ticket');
  const realtime = reportTableData('realtime',missing);
  const seller = realtime.tables[1].rows[1];
  assert.equal(seller[1],0);
  assert.deepEqual(seller.slice(2,6),['—','—','—','—']);
  assert.equal(seller[6],'—','zero comparison base is not a valid growth rate');
  assert.equal(seller[11],0,'known zero prior revenue is still displayed');
  assert.doesNotMatch(render('generated',missing),/NaN|Infinity|null|undefined/);
});

test('agenda comparison and breakdown use attributed sales rather than whole-store revenue', () => {
  const data = reportTableData('generated',fixture());
  assert.equal(data.rows[0][4],700);
  assert.equal(data.rows[0][5],100,'700 attributed vs350 attributed is100%, not comparison with store800');
  assert.deepEqual(data.rows[1].slice(6),Array(6).fill('—'),'origins are not inferred from attribution');
  assert.deepEqual(data.tables[1].rows,[['Pós-venda','Ana',700,350,100]]);
  assert.deepEqual(data.tables[2].rows,[['Pós-venda','Quiosque A',700,350,100]]);
  const dataWithoutPrior = fixture();
  delete dataWithoutPrior.by_agenda[0].previous_gross;
  assert.equal(reportTableData('generated',dataWithoutPrior).rows[0][5],'—','whole-store prior cannot substitute attributed prior');
});

test('realtime keeps store and seller totals distinct and includes every requested channel column', () => {
  const data = reportTableData('realtime',fixture());
  assert.equal(data.tables.length,2);
  for (const table of data.tables) {
    for (const header of ['Total','Salão','CDIG','STV','Mala','SSSG (364 dias)','OFF','ON','Proj. em %','Proj. em R$','Last year (364 dias)','Meta mensal']) assert.ok(table.headers.includes(header));
  }
  assert.equal(data.tables[0].rows[0][1],1200);
  assert.equal(data.tables[0].rows[0][6],50);
  assert.equal(data.tables[0].rows[0][12],2000,'store goal excludes seller and another store goals');
  assert.equal(data.tables[1].rows[0][1],1000,'unassigned sales are not invented for a seller');
  assert.equal(data.tables[1].rows[0][6],100);
  assert.equal(data.tables[1].rows[0][12],1500);
  assert.deepEqual(data.headers,['Tipo',...data.tables[0].headers]);
  assert.equal(data.rows.length,4);
  const html = render('realtime');
  assert.match(html,/mapeamento/);
  assert.match(html,/data-action="ranking"/);
  for (const action of ['excel','csv','share-report']) assert.ok(html.includes(`data-action="${action}"`));
});

test('Dedo Duro total is weighted by available contacts and counts Gotas exactly once', () => {
  const snapshot = fixture();
  snapshot.by_seller.push({name:'Bruno',available_preferencial:4,completed_preferencial:1,completed_gotas:3,gross:10000});
  const data = reportTableData('performance',snapshot);
  assert.deepEqual(data.rows[0],['TOTAL GERAL',10,6,60,5,11]);
  assert.equal(data.rows[1][5],7);
  assert.equal(data.rows[2][5],4);
});

test('SSS shows a real decline to zero but no percentage for missing or zero comparison', () => {
  const snapshot = fixture();
  snapshot.by_store = [{store_id:'store-a',name:'A',gross:0,orders:0,previous_gross:100},{store_id:'store-b',name:'B',gross:500,orders:1,previous_gross:0},{store_id:'store-c',name:'C',gross:500,orders:1}];
  const rows = reportTableData('by-store',snapshot).rows;
  assert.equal(rows[1][6],-100);
  assert.equal(rows[2][6],'—');
  assert.equal(rows[3][6],'—','cross-store total cannot substitute a missing row comparison');
});

test('target and current-day metrics respect their scope and agenda filters suppress attainment', () => {
  const manager = render('sales');
  assert.match(manager,/60%/);
  assert.match(manager,/50% em relação a ontem/);
  const seller = render('sales',fixture(),{profile:{id:'seller-a',role:'seller'}});
  assert.match(seller,/Minha meta/);
  assert.match(seller,/80%/);
  const filtered = fixture();
  filtered.filters.agenda_id = 'agenda-a';
  assert.match(render('sales',filtered),/não é dividida por agenda/);
  assert.doesNotMatch(render('sales',filtered),/<progress /);
  const noYesterday = fixture();
  noYesterday.totals.yesterday_gross = 0;
  assert.match(render('sales',noYesterday),/Comparação com ontem indisponível/);
});

test('overview, personal sales and store management render different workflows using real snapshot data', () => {
  const overview = render('overview');
  const sales = render('sales');
  const store = render('store');
  assert.match(overview,/Contatos pendentes/);
  assert.match(overview,/data-action="nav:agendas"/);
  assert.match(sales,/Vendi hoje/);
  assert.match(sales,/Vendas por dia/);
  assert.match(store,/Participação da equipe/);
  assert.match(store,/Meta mensal da loja/);
  assert.match(store,/data-action="target"/);
  assert.doesNotMatch(overview,/Minha meta|Consolidado por loja/);
  assert.notEqual(overview,sales);
  assert.notEqual(sales,store);
});

test('untrusted labels are escaped throughout headers, metric highlights and nested breakdowns', () => {
  const snapshot = fixture();
  const attack = '<img src=x onerror="alert(1)">';
  snapshot.by_agenda[0].name = attack;
  snapshot.by_agenda[0].by_seller[0].name = attack;
  snapshot.by_seller[0].name = attack;
  snapshot.stores[0].name = attack;
  snapshot.latest_sync = {status:attack,started_at:'2026-11-01T10:00:00Z'};
  for (const route of ['overview','sales','store','generated','by-store','realtime','performance']) {
    const html = render(route,snapshot);
    assert.doesNotMatch(html,/<img|onerror="/);
    if (['overview','sales','store','generated','realtime','performance'].includes(route)) assert.match(html,/&lt;img/);
  }
});

test('rendering and exports do not mutate shared snapshot arrays or synthesize empty records', () => {
  const snapshot = fixture();
  const before = structuredClone(snapshot);
  for (const route of ['overview','sales','store','generated','by-store','realtime','performance']) {render(route,snapshot);reportTableData(route,snapshot);}
  assert.deepEqual(snapshot,before);
  assert.equal(reportTableData('generated',{}).rows.length,0);
  assert.equal(reportTableData('realtime',{}).rows.length,0);
  assert.equal(renderReportPage({route:'unknown'}),'');
});
