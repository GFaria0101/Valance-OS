import {zipSync,strToU8} from 'fflate';
const xmlText=s=>String(s).replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,'');
const xml=s=>xmlText(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function csvText(rows){return '\ufeff'+rows.map(row=>row.map(value=>{let s=String(value??'');if(typeof value==='string'&&/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(';')).join('\r\n');}
export function downloadFile(data,name,type){const link=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type}));link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
export function excelBytes(rows){
  return workbookBytes([{title:'Valance',headers:rows[0]||[],rows:rows.slice(1)}]);
}
export function workbookBytes(tables){
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const column=index=>{let s='';for(let n=index+1;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
  const usedNames=new Set();
  const truncate=(value,length)=>{let result='';for(const char of value){if(result.length+char.length>length)break;result+=char;}return result;};
  const sheetName=(title,index)=>{
    let base=xmlText(title??'').replace(/[\x00-\x1f\x7f\[\]:*?/\\]/g,' ').trim().replace(/^'+|'+$/g,'').trim()||`Tabela ${index+1}`;
    if(base.toLowerCase()==='history')base+=' _';
    let name=truncate(base,31).replace(/'+$/g,'').trimEnd(),suffix=1;
    while(usedNames.has(name.toLowerCase())){const end=` (${++suffix})`;name=truncate(base,31-end.length)+end;}
    usedNames.add(name.toLowerCase());return name;
  };
  const sheets=(tables.length?tables:[{title:'Valance',headers:[],rows:[]}]).map((table,index)=>({name:sheetName(table.title,index),rows:[table.headers,...table.rows]}));
  const files={
    '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,index)=>`<Override PartName="/xl/worksheets/sheet${index+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet,index)=>`<sheet name="${xml(sheet.name)}" sheetId="${index+1}" r:id="rId${index+1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,index)=>`<Relationship Id="rId${index+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index+1}.xml"/>`).join('')}</Relationships>`
  };
  for(const [index,sheet]of sheets.entries()){
    const rows=sheet.rows,width=Math.max(0,...rows.map(row=>row.length));
    const data=rows.map((row,r)=>`<row r="${r+1}">${row.map((value,c)=>typeof value==='number'&&Number.isFinite(value)?`<c r="${column(c)}${r+1}"><v>${value}</v></c>`:`<c r="${column(c)}${r+1}" t="inlineStr"><is><t xml:space="preserve">${xml(value??'')}</t></is></c>`).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${index+1}.xml`]=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${data}</sheetData>${width?`<autoFilter ref="A1:${column(width-1)}${rows.length}"/>`:''}</worksheet>`;
  }
  return zipSync(Object.fromEntries(Object.entries(files).map(([name,data])=>[name,strToU8(data)])));
}
