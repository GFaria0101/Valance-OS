import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRecords,filterRecords,sumRecords,groupRecords,DEFAULT_FILTERS,shiftYearDate,initialContacts,allocationPreview,growth} from '../src/report-data.js';
import {excelBytes,csvText} from '../src/export.js';
import {unzipSync,strFromU8} from 'fflate';
const users=[['Ana','ana','52998224725','A',true,18000],['Bruno','bruno','16899535009','B',true,9000]];
const agendas=[['Pós-venda','','',10,9,1000],['Reativação','','',8,6,500]];
const records=buildRecords(users,agendas);
test('custom dates, seller, agenda and channel filters constrain actual records',()=>{
 const f={...DEFAULT_FILTERS,from:'2026-10-10',to:'2026-10-12',seller:'1',agenda:'0',channel:'digital'};
 const rows=filterRecords(records,f);assert.equal(rows.length,3);assert(rows.every(r=>r.seller===1&&r.agenda===0&&r.channel==='digital'));
 assert.equal(filterRecords(records,{...f,from:'2027-01-01',to:'2027-01-02'}).length,0);
 const all=sumRecords(filterRecords(records,DEFAULT_FILTERS));
 const grouped=groupRecords(filterRecords(records,DEFAULT_FILTERS),filterRecords(records,DEFAULT_FILTERS,'364'),'seller',users,agendas);
 assert(Math.abs(grouped.reduce((s,r)=>s+r.revenue,0)-all.revenue)<1e-7);
 assert(Math.abs(all.digital+all.physical-all.revenue)<1e-7);
 assert(grouped.every(r=>r.revenue>0&&r.orders>0));
});
test('364-day and Gregorian calendars use distinct, correct comparison dates',()=>{
 assert.equal(shiftYearDate('2026-10-18','364'),'2025-10-19');
 assert.equal(shiftYearDate('2026-10-18','gregorian'),'2025-10-18');
 assert.equal(new Date('2026-10-18').getUTCDay(),new Date(shiftYearDate('2026-10-18','364')).getUTCDay());
 assert.notEqual(sumRecords(filterRecords(records,DEFAULT_FILTERS,'364')).revenue,sumRecords(filterRecords(records,DEFAULT_FILTERS,'gregorian')).revenue);
 assert.equal(growth(5,0),null);
});
test('distribution preserves eligible contacts, balances sellers and rejects over-allocation',()=>{
 const contacts=initialContacts();contacts[0].seller=0;contacts[1].done=true;
 const plan=allocationPreview(contacts,'0',7,[0,1]);
 assert.equal(plan.length,7);assert.equal(new Set(plan.map(r=>r.id)).size,7);
 assert(!plan.some(r=>r.id===contacts[0].id||r.id===contacts[1].id));
 assert.equal(plan.filter(r=>r.seller===0).length,4);assert.equal(plan.filter(r=>r.seller===1).length,3);
 assert(contacts.slice(2).every(c=>c.seller===null));
 assert.throws(()=>allocationPreview(contacts,'0',20,[0]),/somente/);
 assert.throws(()=>allocationPreview(contacts,'all',1,[]),/Selecione/);
 assert.throws(()=>allocationPreview(contacts,'all',1.5,[0]),/inteira/);
});
test('Excel is a real XLSX ZIP with numeric cells and escaped user content',()=>{
 const bytes=excelBytes([['Vendedor','Vendas'],['Ana & <Equipe>',1234.5]]);
 assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b);
 const files=unzipSync(bytes);assert(files['[Content_Types].xml']);assert(files['xl/workbook.xml']);
 const sheet=strFromU8(files['xl/worksheets/sheet1.xml']);
 assert(sheet.includes('Ana &amp; &lt;Equipe&gt;'));assert(sheet.includes('<v>1234.5</v>'));
 assert(sheet.includes('A1:B2'));
 assert(csvText([['=HYPERLINK("bad")']]).includes("'=HYPERLINK"));
});
