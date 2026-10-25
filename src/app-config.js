export function readAppConfig(env={}){
  const mode=env.VITE_APP_MODE||'production';
  if(!['production','demo'].includes(mode))throw new Error('VITE_APP_MODE deve ser production ou demo.');
  const url=env.VITE_SUPABASE_URL||'',key=env.VITE_SUPABASE_ANON_KEY||'';
  // Even a demo build must never embed an administrative key by accident.
  if(key){
    if(/service_role|sb_secret_/.test(key))throw new Error('Configure somente a chave pública do Supabase em VITE_SUPABASE_ANON_KEY.');
    if(key.split('.').length===3){try{const payload=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(payload.role!=='anon')throw new Error();}catch{throw new Error('A chave do navegador deve ser pública (anon).');}}
    else if(!key.startsWith('sb_publishable_'))throw new Error('Chave pública do Supabase inválida.');
  }
  if(mode==='demo')return {mode};
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url))throw new Error('Configure VITE_SUPABASE_URL com o endereço HTTPS do projeto Supabase.');
  if(!key)throw new Error('Configure somente a chave pública do Supabase em VITE_SUPABASE_ANON_KEY.');
  return {mode,url:url.replace(/\/$/,''),key};
}
