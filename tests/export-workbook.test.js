import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {workbookBytes,excelBytes} from '../src/export.js';

const read = bytes => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name,data])=>[name,strFromU8(data)]));

test('multi-table exports create linked worksheets with independent headers, full filters and frozen header rows',()=>{
  const wide=Array.from({length:28},(_,n)=>`Coluna ${n+1}`);
  const files=read(workbookBytes([{title:'Agendas',headers:['Agenda','Vendas','SSS'],rows:[['Pós-venda',1234.5,0],['Reativação',0,'—']]},{title:'Vendedores',headers:wide,rows:[wide.map((_,n)=>n)]}]));
  assert.match(files['xl/workbook.xml'],/<sheet name="Agendas" sheetId="1" r:id="rId1"/);
  assert.match(files['xl/workbook.xml'],/<sheet name="Vendedores" sheetId="2" r:id="rId2"/);
  assert.match(files['xl/_rels/workbook.xml.rels'],/Id="rId2"[^>]*Target="worksheets\/sheet2.xml"/);
  for(const n of [1,2]){
    assert.ok(files[`xl/worksheets/sheet${n}.xml`]);
    assert.ok(files['[Content_Types].xml'].includes(`PartName="/xl/worksheets/sheet${n}.xml"`));
    assert.match(files[`xl/worksheets/sheet${n}.xml`],/ySplit="1" topLeftCell="A2"[^>]*state="frozen"/);
  }
  assert.match(files['xl/worksheets/sheet1.xml'],/<autoFilter ref="A1:C3"/);
  assert.match(files['xl/worksheets/sheet2.xml'],/<autoFilter ref="A1:AB2"/);
  assert.match(files['xl/worksheets/sheet1.xml'],/<c r="B2"><v>1234.5<\/v><\/c>/);
  assert.match(files['xl/worksheets/sheet1.xml'],/<c r="C2"><v>0<\/v><\/c>/);
  assert.doesNotMatch(files['xl/worksheets/sheet1.xml'],/<t[^>]*>Agendas<\/t>/,'the sheet title must not precede the headers');
});

test('sheet names are valid, at most31 UTF-16 units and unique without case sensitivity',()=>{
  const titles=["'Equipe:*?/\\[A]'",'equipe       A',"'".repeat(3),'A'.repeat(45),'A'.repeat(45),'a'.repeat(45),'😀'.repeat(25),'B'.repeat(30)+"'fim",'History'];
  const files=read(workbookBytes(titles.map(title=>({title,headers:['Nome'],rows:[]}))));
  const names=[...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(names.length,titles.length);
  assert.equal(new Set(names.map(name=>name.toLowerCase())).size,titles.length);
  for(const name of names){assert.ok(name.length<=31);assert.doesNotMatch(name,/[\[\]:*?/\\]|^'|'$/);}
  assert.ok(!names.some(name=>name.toLowerCase()==='history'));
  assert.ok(names[2].startsWith('Tabela'));
  assert.match(files['xl/worksheets/sheet3.xml'],/<autoFilter ref="A1:A1"/);
});

test('untrusted strings remain escaped inline text, never formulas or injected XML',()=>{
  const files=read(workbookBytes([{title:'A & "B"',headers:['Nome <grupo>','Valor'],rows:[['=HYPERLINK("https://example.com")',-4],['<c><f>1+1</f></c>&\u0001',NaN]]}]));
  assert.match(files['xl/workbook.xml'],/name="A &amp; &quot;B&quot;"/);
  const sheet=files['xl/worksheets/sheet1.xml'];
  assert.match(sheet,/<c r="A2" t="inlineStr">/);
  assert.match(sheet,/=HYPERLINK\(&quot;https:\/\/example.com&quot;\)/);
  assert.match(sheet,/&lt;c&gt;&lt;f&gt;1\+1&lt;\/f&gt;&lt;\/c&gt;&amp;/);
  assert.doesNotMatch(sheet,/<f>|\u0001/);
  assert.match(sheet,/<c r="B2"><v>-4<\/v><\/c>/);
  assert.match(sheet,/<c r="B3" t="inlineStr">/);
});

test('legacy excelBytes delegates to a single Valance worksheet and empty workbooks stay valid',()=>{
  const rows=[['Nome','Vendas'],['Ana',20]];
  assert.deepEqual(read(excelBytes(rows)),read(workbookBytes([{title:'Valance',headers:rows[0],rows:rows.slice(1)}])));
  const files=read(workbookBytes([]));
  assert.ok(files['xl/worksheets/sheet1.xml']);
  assert.doesNotMatch(files['xl/worksheets/sheet1.xml'],/<autoFilter/);
  assert.ok(excelBytes([]).length>0);
});
