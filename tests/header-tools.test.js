import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePhone,greetingForHour,searchEntries} from '../src/header-tools.js';

test('greeting changes at morning, noon and evening boundaries, including 17h',()=>{
 for(const [hour,expected] of [[0,'Boa noite'],[4,'Boa noite'],[5,'Bom dia'],[11,'Bom dia'],[12,'Boa tarde'],[17,'Boa tarde'],[18,'Boa noite'],[23,'Boa noite']])assert.equal(greetingForHour(hour),expected);
});
test('WhatsApp supports Brazilian mobile/landline, explicit country codes and rejects invalid input',()=>{
 assert.equal(normalizePhone('(11) 99999-8888'),'5511999998888');
 assert.equal(normalizePhone('11 3333-4444'),'551133334444');
 assert.equal(normalizePhone('55 21 99999-8888'),'5521999998888');
 assert.equal(normalizePhone('+351 912 345 678'),'351912345678');
 for(const input of ['', '1199','abc11999998888','+0123456789','(20) 99999-8888','11 89999-8888','+55 11 9999','++351912345678'])assert.throws(()=>normalizePhone(input));
});
test('global search finds screens, users, formatted CPF and contacts without requiring accents',()=>{
 const entries=[{kind:'screen',name:'Distribuir contatos',detail:'Abrir tela',terms:'distribuição'},
 {kind:'seller',name:'João Pedro',detail:'Vendedor cupom RSV4280',terms:'52998224725'},
 {kind:'contact',name:'Mariana Costa',detail:'Contato pós-venda'}];
 assert.equal(searchEntries(entries,'distribuicao')[0].name,'Distribuir contatos');
 assert.equal(searchEntries(entries,'joao')[0].name,'João Pedro');
 assert.equal(searchEntries(entries,'529.982.247-25')[0].name,'João Pedro');
 assert.equal(searchEntries(entries,'RSV4280')[0].kind,'seller');
 assert.equal(searchEntries(entries,'Mariana')[0].kind,'contact');
 assert.equal(searchEntries(entries,'inexistente').length,0);
 assert.equal(searchEntries(entries,'')[0].kind,'screen');
});
