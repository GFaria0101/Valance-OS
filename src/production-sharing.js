export function staffShareText(staff,storeName,siteUrl){
  return [`Equipe · ${storeName}`,siteUrl,'',...staff.map(p=>`${p.name} · ${p.role==='manager'?'Gerente':p.role==='admin'?'Administrador':'Vendedor'} · ${p.email} · ${p.is_active?'Ativo':'Desativado'}`)].join('\n');
}

export function invitationShareText({name,email,siteUrl}){
  return `Olá, ${name}! Seu convite para o Valance OS foi enviado para ${email}.\nAcesse ${siteUrl}\nUse o e-mail do convite para definir sua própria senha. Se não encontrar a mensagem, confira a pasta de spam ou fale com o administrador.`;
}

export function agendaDayMessage({total,pending},now=new Date()){
  if(total===null||pending===null)return null;
  if(!total)return {title:'Sem contatos para hoje',description:'O gerente pode gerar as agendas e distribuir os contatos disponíveis.'};
  if(pending>0)return {title:`${pending} contato${pending===1?'':'s'} pendente${pending===1?'':'s'} para hoje`,description:'Registre o resultado de cada atendimento para acompanhar o andamento das agendas.'};
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now).split('-').map(Number);
  const next=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]+1));
  return {title:'Tudo concluído por hoje',description:`Próxima janela de atendimento: ${next.toLocaleDateString('pt-BR',{timeZone:'UTC'})}, a partir das 10h (Brasília). Novos contatos dependem da geração e distribuição pelo gerente.`};
}
