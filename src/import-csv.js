export const importHeaders={customers:['external_id','name','phone','birth_date','responsible_external_id'],sales:['external_id','customer_external_id','seller_external_id','sold_at','gross_amount','discount_amount','returned_amount','status']};
export function parseCSV(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>1000000)throw new Error('O arquivo deve ter até 1 MB.');
  text=text.replace(/^\ufeff/,'');const separator=text.split(/\r?\n/,1)[0].includes(';')?';':',';
  const rows=[];let row=[],field='',quoted=false;
  for(let index=0;index<text.length;index++){
    const char=text[index];
    if(char==='"'){if(quoted&&text[index+1]==='"'){field+='"';index++;}else if(quoted||field==='')quoted=!quoted;else throw new Error('Aspas inválidas no CSV.');}
    else if(!quoted&&char===separator){row.push(field.trim());field='';}
    else if(!quoted&&(char==='\n'||char==='\r')){if(char==='\r'&&text[index+1]==='\n')index++;row.push(field.trim());if(row.some(Boolean))rows.push(row);row=[];field='';}
    else field+=char;
  }
  if(quoted)throw new Error('Uma coluna contém aspas não fechadas.');
  row.push(field.trim());if(row.some(Boolean))rows.push(row);
  if(rows.length<2)throw new Error('O CSV deve conter cabeçalho e pelo menos uma linha.');
  if(rows.length>501)throw new Error('Importe no máximo 500 registros por arquivo.');
  const headers=rows.shift().map(s=>s.toLowerCase());if(new Set(headers).size!==headers.length)throw new Error('O cabeçalho tem colunas repetidas.');
  return rows.map((values,index)=>{if(values.length!==headers.length)throw new Error(`Linha ${index+2}: quantidade de colunas diferente do cabeçalho.`);return Object.fromEntries(headers.map((h,n)=>[h,values[n]]));});
}
export function parseImportCSV(text,kind){
  if(!importHeaders[kind])throw new Error('Tipo de importação inválido.');
  const rows=parseCSV(text);const required=kind==='customers'?['external_id','name']:['external_id','sold_at','gross_amount'];
  return rows.map((row,index)=>{
    for(const key of required)if(!row[key])throw new Error(`Linha ${index+2}: preencha ${key}.`);
    const result={};for(const key of importHeaders[kind])if(Object.hasOwn(row,key))result[key]=row[key];
    if(kind==='sales'){
      for(const key of ['discount_amount','returned_amount','status'])if(result[key]==='')delete result[key];
      for(const key of ['gross_amount','discount_amount','returned_amount'])if(result[key]!==undefined){const value=Number(result[key].replace(',','.'));if(!Number.isFinite(value)||value<0)throw new Error(`Linha ${index+2}: ${key} deve ser um valor positivo.`);result[key]=value;}
      if(result.status!==undefined&&!['completed','cancelled'].includes(result.status))throw new Error(`Linha ${index+2}: status deve ser completed ou cancelled.`);
      if(!/^\d{4}-\d{2}-\d{2}T/.test(result.sold_at)||!Number.isFinite(Date.parse(result.sold_at)))throw new Error(`Linha ${index+2}: sold_at deve ser data/hora ISO com fuso, por exemplo 2026-10-25T14:00:00-03:00.`);
      if(!/(Z|[+-]\d{2}:\d{2})$/.test(result.sold_at))throw new Error(`Linha ${index+2}: informe o fuso em sold_at.`);
    }
    return result;
  });
}
