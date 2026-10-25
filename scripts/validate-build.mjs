import {readAppConfig} from '../src/app-config.js';
for(const name of Object.keys(process.env)){
  if(/^VITE_.*(?:SECRET|SERVICE_ROLE|PASSWORD|TOKEN)/i.test(name))throw new Error('Não configure segredos em variáveis VITE_: elas são públicas no navegador.');
}
readAppConfig(process.env);
