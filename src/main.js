import {readAppConfig} from './app-config.js';
const app=document.querySelector('#app');
(async()=>{try{
  const config=readAppConfig({VITE_APP_MODE:import.meta.env.VITE_APP_MODE,VITE_SUPABASE_URL:import.meta.env.VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY:import.meta.env.VITE_SUPABASE_ANON_KEY});
  if(import.meta.env.VITE_APP_MODE==='demo')await import('./demo-app.js');
  else {const {startProduction}=await import('./production-app.js');await startProduction(config);}
}catch(error){
  app.textContent='';const box=document.createElement('section');box.style='max-width:650px;margin:12vh auto;padding:32px;font:16px/1.7 sans-serif;color:#203c35;background:#f4f7ef;border-radius:12px';
  const title=document.createElement('h1');title.textContent='Configuração do ambiente necessária';
  const message=document.createElement('p');message.textContent=error.message;
  const note=document.createElement('p');note.textContent='O acesso de produção permanece fechado. Consulte docs/deploy.md para configurar o banco e a publicação.';
  box.append(title,message,note);app.append(box);
}
})();
