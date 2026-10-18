export const DEMO_DAY = '2026-10-18';
export const STORE = 'Reserva Downtown';
export const DEFAULT_FILTERS = {from:'2026-10-01',to:DEMO_DAY,agenda:'all',seller:'all',channel:'all',minimum:'0'};
export const number = value => value.toLocaleString('pt-BR',{maximumFractionDigits:1});
export const percent = value => `${number(value)}%`;
export function shiftYearDate(date,calendar='gregorian') {
  const d=new Date(`${date}T12:00:00Z`);
  if(calendar==='364') d.setUTCDate(d.getUTCDate()-364);
  else d.setUTCFullYear(d.getUTCFullYear()-1);
  return d.toISOString().slice(0,10);
}
export function buildRecords(users,agendas) {
  const records=[],counters=new Map(),weightTotal=agendas.reduce((s,a)=>s+a[5],0);
  for(const [start,end,yearFactor] of [['2026-10-01',DEMO_DAY,1],['2025-09-01','2025-11-30',.84]]){
    for(let date=new Date(`${start}T12:00:00Z`);date.toISOString().slice(0,10)<=end;date.setUTCDate(date.getUTCDate()+1)){
      const day=date.getUTCDate(),weekday=date.getUTCDay(),dateKey=date.toISOString().slice(0,10);
      users.forEach((user,seller)=>agendas.forEach((agenda,agendaId)=>{
        const scale=(.72+weekday*.07+(day%4)*.03)*yearFactor;
        const total=Math.round(user[5]/18*agenda[5]/weightTotal*scale*100)/100;
        const available=3+(day+seller+agendaId)%6;
        const done=Math.max(0,available-((seller+day)%4));
        const extra=(seller+agendaId+day)%4;
        const digital=Math.round(total*.23*100)/100;
        for(const channel of ['store','digital']){
          const revenue=channel==='store'?Math.round((total-digital)*100)/100:digital;
          const counterKey=`${date.getUTCFullYear()}-${seller}-${channel}`;
          const prior=counters.get(counterKey)||0,next=prior+Math.round(revenue*100);
          counters.set(counterKey,next);
          records.push({date:dateKey,seller,agenda:agendaId,store:STORE,channel,
            revenue,
            available:channel==='store'?available:0,done:channel==='store'?done:0,
            extra:channel==='store'?extra:0,
            orders:Math.floor(next/24000)-Math.floor(prior/24000),pieces:Math.floor(next/11000)-Math.floor(prior/11000)});
        }
      }));
    }
  }
  return records;
}
export function filterRecords(records,filters,calendar=null) {
  const from=calendar?shiftYearDate(filters.from,calendar):filters.from;
  const to=calendar?shiftYearDate(filters.to,calendar):filters.to;
  return records.filter(r=>r.date>=from&&r.date<=to&&
    (filters.agenda==='all'||r.agenda===Number(filters.agenda))&&
    (filters.seller==='all'||r.seller===Number(filters.seller))&&
    (filters.channel==='all'||r.channel===filters.channel)&&r.revenue>=Number(filters.minimum||0));
}
export function sumRecords(records){
  const result={revenue:0,available:0,done:0,extra:0,orders:0,pieces:0,digital:0,physical:0};
  for(const r of records){for(const key of ['revenue','available','done','extra','orders','pieces'])result[key]+=r[key];result[r.channel==='digital'?'digital':'physical']+=r.revenue;}
  return result;
}
export function growth(current,previous){return previous?((current-previous)/previous)*100:null;}
export function groupRecords(records,previous,key,users,agendas){
  const names={agenda:id=>agendas[id]?.[0]||'Agenda',seller:id=>users[id]?.[0]||'Vendedor',store:id=>id};
  const ids=[...new Set(records.map(r=>r[key]))];
  return ids.map(id=>({id,name:names[key](id),...sumRecords(records.filter(r=>r[key]===id)),previous:sumRecords(previous.filter(r=>r[key]===id))}));
}
const demoNames=['Mariana Costa','Rafael Almeida','Camila Santos','Lucas Ferreira','Beatriz Oliveira','Gabriel Souza','Isabela Lima','Felipe Rocha','Ana Martins','Bruno Pereira','Clara Ribeiro','Diego Gomes'];
export function initialContacts(completed=[]){
  return [12,8,12,9,6].flatMap((count,agenda)=>Array.from({length:count},(_,n)=>({
    id:`${agenda}-${n}`,name:demoNames[(n+agenda*3)%demoNames.length],agenda,
    seller:null,done:completed.includes(agenda),date:DEMO_DAY,source:n%4===0?'Gotas':'Preferencial'
  })));
}
export function allocationPreview(contacts,agenda,quantity,sellers){
  const count=Number(quantity);
  if(!Number.isInteger(count)||count<1)throw new Error('Informe uma quantidade inteira maior que zero.');
  if(!sellers.length)throw new Error('Selecione pelo menos um vendedor com acesso ativo.');
  const pool=contacts.filter(c=>!c.done&&c.seller===null&&(agenda==='all'||c.agenda===Number(agenda)));
  if(count>pool.length)throw new Error(`Há somente ${pool.length} contatos disponíveis para esta seleção.`);
  return pool.slice(0,count).map((contact,n)=>({id:contact.id,seller:sellers[n%sellers.length]}));
}
