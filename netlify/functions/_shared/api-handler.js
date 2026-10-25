const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_FIELDS='id,organization_id,store_id,role,name,email,cpf,handle,coupon,external_id,is_active';
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
function object(value){if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'Envie um objeto JSON válido.');return value;}
function keys(value,allowed){for(const key of Object.keys(value))if(!allowed.includes(key))throw new ApiError(400,`Campo não permitido: ${key}.`);}
function uuid(value,label){if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,`${label} inválido.`);return value;}
function text(value,label,max=160,{optional=false}={}){if(optional&&(value===undefined||value===null||value===''))return null;if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new ApiError(400,`${label} inválido.`);return value.trim();}
function money(value,label){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e12)throw new ApiError(400,`${label} deve ser um valor numérico não negativo.`);return Math.round(value*100)/100;}
function date(value,label,{optional=false}={}){if(optional&&(value===undefined||value===null||value===''))return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw new ApiError(400,`${label} inválida; use AAAA-MM-DD.`);return value;}
function database(result){if(!result.error)return result.data;const code=result.error.code;if(code==='42501')throw new ApiError(403,'Você não tem permissão para esta operação.');if(code==='23505')throw new ApiError(409,'Já existe um registro com este identificador.');if(code==='P0001'||code?.startsWith('22')||code?.startsWith('23'))throw new ApiError(400,'Os dados não atendem às regras da operação. Confira vínculos, valores e identificadores.');throw new ApiError(500,'Não foi possível concluir a operação no banco de dados.');}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});}
export function validateImport(payload){
  object(payload);keys(payload,['customers','sales']);
  const customers=payload.customers??[],sales=payload.sales??[];
  if(!Array.isArray(customers)||!Array.isArray(sales)||customers.length>500||sales.length>500||customers.length+sales.length===0)throw new ApiError(400,'Importe de 1 a 500 clientes e/ou até 500 vendas por lote.');
  const customerIds=new Set(),saleIds=new Set();
  const cleanCustomers=customers.map(row=>{object(row);keys(row,['external_id','name','phone','birth_date','responsible_external_id']);const external_id=text(row.external_id,'Identificador do cliente',120);if(customerIds.has(external_id))throw new ApiError(400,'Cliente repetido no mesmo lote.');customerIds.add(external_id);const clean={external_id,name:text(row.name,'Nome do cliente',160)};if(Object.hasOwn(row,'phone')){const phone=text(row.phone,'Telefone',30,{optional:true});if(phone&&!/^\+?[\d\s().-]{8,30}$/.test(phone))throw new ApiError(400,'Telefone inválido.');clean.phone=phone;}if(Object.hasOwn(row,'birth_date'))clean.birth_date=date(row.birth_date,'Data de nascimento',{optional:true});if(Object.hasOwn(row,'responsible_external_id'))clean.responsible_external_id=text(row.responsible_external_id,'Identificador do vendedor responsável',120,{optional:true});return clean;});
  const cleanSales=sales.map(row=>{
    object(row);keys(row,['external_id','customer_external_id','seller_external_id','sold_at','gross_amount','discount_amount','returned_amount','status']);
    const external_id=text(row.external_id,'Identificador da venda',120);if(saleIds.has(external_id))throw new ApiError(400,'Venda repetida no mesmo lote.');saleIds.add(external_id);
    const sold_at=text(row.sold_at,'Data e hora da venda',40);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(sold_at)||!Number.isFinite(Date.parse(sold_at)))throw new ApiError(400,'Data da venda deve conter hora e fuso, por exemplo 2026-10-25T15:00:00-03:00.');
    const gross_amount=money(row.gross_amount,'Valor bruto'),clean={external_id,sold_at,gross_amount};
    if(Object.hasOwn(row,'customer_external_id'))clean.customer_external_id=text(row.customer_external_id,'Identificador do cliente',120,{optional:true});
    if(Object.hasOwn(row,'seller_external_id'))clean.seller_external_id=text(row.seller_external_id,'Identificador do vendedor',120,{optional:true});
    if(Object.hasOwn(row,'discount_amount')){clean.discount_amount=money(row.discount_amount,'Desconto');if(clean.discount_amount>gross_amount)throw new ApiError(400,'Desconto não pode superar o valor bruto.');}
    if(Object.hasOwn(row,'returned_amount')){clean.returned_amount=money(row.returned_amount,'Devolução');if(clean.returned_amount>gross_amount)throw new ApiError(400,'Devolução não pode superar o valor bruto.');}
    if(Object.hasOwn(row,'status')){if(!['completed','cancelled'].includes(row.status))throw new ApiError(400,'Situação de venda inválida.');clean.status=row.status;}
    return clean;
  });
  return {customers:cleanCustomers,sales:cleanSales};
}
export function createApi({createClient,env=process.env}){
  function config(){const url=env.SUPABASE_URL||env.VITE_SUPABASE_URL,key=env.SUPABASE_ANON_KEY||env.VITE_SUPABASE_ANON_KEY;if(!url||!key)throw new ApiError(503,'Backend ainda não configurado.');try{if(new URL(url).protocol!=='https:')throw Error();}catch{throw new ApiError(503,'URL do backend inválida.');}return {url,key};}
  function adminClient(cfg){if(!env.SUPABASE_SERVICE_ROLE_KEY)throw new ApiError(503,'Administração de usuários ainda não configurada.');return createClient(cfg.url,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});}
  function redirect(kind){if(!env.APP_URL)throw new ApiError(503,'Endereço público do aplicativo não configurado.');let url;try{url=new URL(env.APP_URL);}catch{throw new ApiError(503,'Endereço público inválido.');}if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new ApiError(503,'Endereço público exige HTTPS.');url.pathname='/';url.search=`?auth=${kind}`;url.hash='';return url.toString();}
  return async function handle(request){try{
    const action=new URL(request.url).searchParams.get('action')||'session-info';
    const methods={'session-info':'GET','sync-state':'GET',health:'GET','invite-user':'POST','update-user':'POST','set-access':'POST','reset-user':'POST','sync-presence':'POST','import-presence':'POST'};
    if(!methods[action])throw new ApiError(404,'Operação não encontrada.');
    if(request.method!==methods[action])throw new ApiError(405,'Método não permitido.');
    if(request.method==='POST'&&request.headers.get('origin')&&env.APP_URL&&new URL(env.APP_URL).origin!==request.headers.get('origin'))throw new ApiError(403,'Origem da requisição não permitida.');
    const authorization=request.headers.get('authorization')||'';if(!/^Bearer [^\s]+$/.test(authorization))throw new ApiError(401,'Entre na sua conta para continuar.');
    const cfg=config(),client=createClient(cfg.url,cfg.key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const auth=await client.auth.getUser(authorization.slice(7));if(auth.error||!auth.data?.user)throw new ApiError(401,'Sessão inválida ou expirada.');
    const meResult=await client.from('profiles').select(PROFILE_FIELDS).eq('id',auth.data.user.id).maybeSingle();
    if(meResult.error||!meResult.data||!meResult.data.is_active)throw new ApiError(403,'Seu acesso está desativado ou ainda não foi vinculado à empresa.');
    const me=meResult.data;
    async function scope(storeId){uuid(storeId,'Quiosque');if(me.role==='seller'||(me.role==='manager'&&storeId!==me.store_id))throw new ApiError(403,'Você não pode administrar este quiosque.');const store=database(await client.from('stores').select('id,organization_id,name').eq('id',storeId).eq('organization_id',me.organization_id).maybeSingle());if(!store)throw new ApiError(403,'Quiosque não disponível para esta conta.');return store;}
    async function staff(userId){uuid(userId,'Usuário');const target=database(await client.from('profiles').select(PROFILE_FIELDS).eq('id',userId).eq('organization_id',me.organization_id).maybeSingle());if(!target||me.role==='seller'||(me.role==='manager'&&(target.store_id!==me.store_id||target.role!=='seller'))||(target.role==='admin'&&me.id!==target.id))throw new ApiError(403,'Você não pode administrar este usuário.');return target;}
    if(action==='session-info'){
      const stores=database(await client.from('stores').select('id,organization_id,name,external_id').eq('organization_id',me.organization_id).order('name'));
      const organization=database(await client.from('organizations').select('id,name,timezone').eq('id',me.organization_id).maybeSingle());
      return json({profile:me,stores,organization});
    }
    if(action==='sync-state')return json({runs:database(await client.from('sync_runs').select('*').eq('organization_id',me.organization_id).order('started_at',{ascending:false}).limit(20))});
    if(action==='health')return json({status:'ok',database:true,presence:{status:'awaiting_documentation',automatic_sync:false},whatsapp:{mode:'link',automatic_confirmation:false},backups:{status:'must_be_configured_in_supabase'}});
    if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new ApiError(415,'Envie os dados como application/json.');
    const bytes=await request.arrayBuffer();if(bytes.byteLength>1024*1024)throw new ApiError(413,'Lote muito grande; limite de 1 MiB.');let data;try{data=object(JSON.parse(new TextDecoder().decode(bytes)));}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'JSON inválido.');}
    if(action==='import-presence'){
      keys(data,['store_id','payload']);await scope(data.store_id);const payload=validateImport(data.payload);
      const result=database(await client.rpc('import_presence_batch',{p_store_id:data.store_id,p_payload:payload}));return json({result});
    }
    if(action==='sync-presence'){
      keys(data,['store_id']);if(me.role!=='admin')throw new ApiError(403,'Somente o administrador pode configurar a integração.');if(data.store_id)await scope(data.store_id);
      return json({error:'A sincronização automática depende da documentação e autorização da API do Presence. Use a importação de arquivos até a integração ser configurada.',code:'PRESENCE_NOT_CONFIGURED'},409);
    }
    if(action==='invite-user'){
      keys(data,['store_id','email','name','role','cpf','external_id']);await scope(data.store_id);
      if(!['manager','seller'].includes(data.role)||me.role==='manager'&&data.role!=='seller')throw new ApiError(403,'Perfil de acesso não permitido.');
      const email=text(data.email,'E-mail',254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new ApiError(400,'E-mail inválido.');
      const name=text(data.name,'Nome',160),cpf=text(data.cpf,'CPF',11,{optional:true});if(cpf&&!/^\d{11}$/.test(cpf))throw new ApiError(400,'CPF deve conter 11 números.');const external_id=text(data.external_id,'Identificador do Presence',120,{optional:true});
      const service=adminClient(cfg),invite=await service.auth.admin.inviteUserByEmail(email,{redirectTo:redirect('invite')});
      if(invite.error||!invite.data?.user)throw new ApiError(400,'Não foi possível enviar o convite. Verifique se o e-mail já possui acesso.');
      const id=invite.data.user.id;
      const result=await client.rpc('provision_staff',{p_user_id:id,p_store_id:data.store_id,p_role:data.role,p_name:name,p_email:email,p_cpf:cpf,p_external_id:external_id});
      if(result.error)return json({error:'O convite foi enviado, mas o vínculo ao quiosque não foi concluído. A conta permanece sem acesso até o administrador corrigir o vínculo.',code:'PROFILE_PROVISIONING_PENDING',user_id:id},409);
      return json({user_id:id,status:'invited'},201);
    }
    if(action==='update-user'){
      keys(data,['user_id','name','handle','coupon','external_id']);await staff(data.user_id);
      const result=database(await client.rpc('update_staff_profile',{p_profile_id:data.user_id,p_name:text(data.name,'Nome',160),p_handle:text(data.handle,'Perfil',80,{optional:true})??'',p_coupon:text(data.coupon,'Cupom',40,{optional:true})??'',p_external_id:text(data.external_id,'Identificador do Presence',120,{optional:true})}));return json({result});
    }
    if(action==='set-access'){
      keys(data,['user_id','is_active']);await staff(data.user_id);if(typeof data.is_active!=='boolean')throw new ApiError(400,'Informe se o acesso deve ficar ativo.');
      const service=adminClient(cfg);database(await client.rpc('set_profile_access',{p_profile_id:data.user_id,p_active:data.is_active}));
      const ban=await service.auth.admin.updateUserById(data.user_id,{ban_duration:data.is_active?'none':'876000h'});
      if(ban.error)return json({error:'A permissão no banco foi atualizada, mas a atualização da autenticação precisa ser repetida.',code:'AUTH_UPDATE_PENDING',database_active:data.is_active},503);
      return json({user_id:data.user_id,is_active:data.is_active});
    }
    if(action==='reset-user'){
      keys(data,['user_id']);const target=await staff(data.user_id);if(!target.is_active)throw new ApiError(400,'Ative o usuário antes de enviar a recuperação.');
      const result=await adminClient(cfg).auth.resetPasswordForEmail(target.email,{redirectTo:redirect('recovery')});if(result.error)throw new ApiError(503,'Não foi possível enviar o e-mail de recuperação. Tente novamente.');return json({status:'recovery_sent'});
    }
    throw new ApiError(404,'Operação não encontrada.');
  }catch(error){return json({error:error instanceof ApiError?error.message:'Ocorreu uma falha ao processar a solicitação.'},error instanceof ApiError?error.status:500);}};
}
