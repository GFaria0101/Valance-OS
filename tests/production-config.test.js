import test from 'node:test';
import assert from 'node:assert/strict';
import {readAppConfig} from '../src/app-config.js';
import {parseImportCSV} from '../src/import-csv.js';
test('production fails closed without Supabase; demo requires explicit mode; secret roles never enter browser config',()=>{
 assert.throws(()=>readAppConfig({}),/Configure/);
 assert.equal(readAppConfig({VITE_APP_MODE:'demo'}).mode,'demo');
 assert.throws(()=>readAppConfig({VITE_APP_MODE:'demo',VITE_SUPABASE_ANON_KEY:'sb_secret_not_real'}));
 const config={VITE_SUPABASE_URL:'https://fixture-project.supabase.co',VITE_SUPABASE_ANON_KEY:'sb_publishable_test_fixture_not_a_real_key'};
 assert.equal(readAppConfig(config).mode,'production');
 assert.throws(()=>readAppConfig({...config,VITE_SUPABASE_ANON_KEY:'sb_secret_not_real'}));
 const jwt=role=>['x',Buffer.from(JSON.stringify({role})).toString('base64url'),'x'].join('.');
 assert.throws(()=>readAppConfig({...config,VITE_SUPABASE_ANON_KEY:jwt('service_role')}));
 assert.throws(()=>readAppConfig({...config,VITE_SUPABASE_ANON_KEY:jwt('authenticated')}));
 assert.equal(readAppConfig({...config,VITE_SUPABASE_ANON_KEY:jwt('anon')}).mode,'production');
});
test('CSV imports preserve quoted customer names, normalize currency and reject malformed/oversized data',()=>{
 assert.deepEqual(parseImportCSV('external_id;name;phone\nC1;"Ana; Silva";5511999998888','customers'),[{external_id:'C1',name:'Ana; Silva',phone:'5511999998888'}]);
 const sales=parseImportCSV('external_id;customer_external_id;seller_external_id;sold_at;gross_amount\nV1;C1;S1;2026-10-25T14:00:00-03:00;123,45','sales');assert.equal(sales[0].gross_amount,123.45);assert(!Object.hasOwn(sales[0],'status'));
 const sparse=parseImportCSV('external_id;name;phone\nC1;Ana;','customers');assert.equal(sparse[0].phone,'');
 const anonymous=parseImportCSV('external_id;sold_at;gross_amount\nV2;2026-10-25T14:00:00-03:00;10','sales');assert(!Object.hasOwn(anonymous[0],'customer_external_id'));
 assert.throws(()=>parseImportCSV('external_id,name\na,"unclosed','customers'),/aspas/);
 assert.throws(()=>parseImportCSV('external_id,name,name\na,b,c','customers'),/repetidas/);
 assert.throws(()=>parseImportCSV('external_id,name\n'+Array.from({length:501},(_,n)=>`${n},Name`).join('\n'),'customers'),/500/);
 assert.throws(()=>parseImportCSV('external_id;customer_external_id;seller_external_id;sold_at;gross_amount\nV1;C1;S1;2026-10-25T14:00:00;-1','sales'),/positivo/);
});
