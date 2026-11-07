import test from 'node:test';
import assert from 'node:assert/strict';
import {agendaDayMessage,staffShareText,invitationShareText} from '../src/production-sharing.js';

test('daily agenda distinguishes empty, pending, completed and unknown counts with the next Brasília day',()=>{
  assert.equal(agendaDayMessage({total:null,pending:null}),null);
  assert.equal(agendaDayMessage({total:0,pending:0}).title,'Sem contatos para hoje');
  assert.match(agendaDayMessage({total:60,pending:1}).title,/1 contato pendente/);
  const done=agendaDayMessage({total:60,pending:0},new Date('2026-11-08T01:00:00Z'));
  assert.equal(done.title,'Tudo concluído por hoje');
  assert.match(done.description,/08\/11\/2026/);
  assert.match(done.description,/dependem da geração/);
});

test('team and invitation sharing contain only intended contact fields and never account credentials',()=>{
  const member={name:'Vendedor exemplo',email:'seller@example.test',role:'seller',is_active:true,cpf:'12345678901',password:'never-share-this',coupon:'PRIVATE'};
  const list=staffShareText([member],'Quiosque 1','https://example.test');
  assert.match(list,/Vendedor exemplo/);assert.match(list,/Ativo/);
  assert(!list.includes(member.cpf));assert(!list.includes(member.password));assert(!list.includes(member.coupon));
  const invite=invitationShareText({...member,siteUrl:'https://example.test'});
  assert.match(invite,/definir sua própria senha/);assert(!invite.includes(member.password));
});
