-- Durable store references preserve commercial history when current roles change.
-- Historical membership never grants access: authorization remains in profiles.
begin;

create table public.profile_store_memberships (
 organization_id uuid not null,store_id uuid not null,profile_id uuid not null,
 was_seller boolean not null default false,created_at timestamptz not null default now(),
 primary key(organization_id,store_id,profile_id),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,profile_id) references public.profiles(organization_id,id)
);
create table public.profile_external_ids (
 organization_id uuid not null,store_id uuid not null,external_id text not null check(length(trim(external_id)) between 1 and 150),profile_id uuid not null,
 primary key(organization_id,store_id,external_id),
 foreign key(organization_id,store_id,profile_id) references public.profile_store_memberships(organization_id,store_id,profile_id)
);
alter table public.profile_store_memberships enable row level security;
alter table public.profile_external_ids enable row level security;
revoke all on public.profile_store_memberships,public.profile_external_ids from public,anon,authenticated;
grant all on public.profile_store_memberships,public.profile_external_ids to service_role;

insert into public.profile_store_memberships(organization_id,store_id,profile_id,was_seller)
 select p.organization_id,p.store_id,p.id,p.role='seller'
 or exists(select 1 from public.sales s where s.seller_id=p.id and s.store_id=p.store_id)
 or exists(select 1 from public.customers c where c.responsible_id=p.id and c.store_id=p.store_id)
 or exists(select 1 from public.contact_tasks t where t.assigned_to=p.id and t.store_id=p.store_id)
 or exists(select 1 from public.sales_targets t where t.seller_id=p.id and t.store_id=p.store_id)
 from public.profiles p where p.store_id is not null;
insert into public.profile_external_ids(organization_id,store_id,external_id,profile_id)
 select m.organization_id,m.store_id,p.external_id,p.id from public.profile_store_memberships m
 join public.profiles p on p.id=m.profile_id where m.was_seller and nullif(trim(p.external_id),'') is not null;

alter table public.customers drop constraint customers_organization_id_store_id_responsible_id_fkey;
alter table public.customers add constraint customers_organization_id_store_id_responsible_id_fkey
 foreign key(organization_id,store_id,responsible_id) references public.profile_store_memberships(organization_id,store_id,profile_id);
alter table public.contact_tasks drop constraint contact_tasks_organization_id_store_id_assigned_to_fkey;
alter table public.contact_tasks add constraint contact_tasks_organization_id_store_id_assigned_to_fkey
 foreign key(organization_id,store_id,assigned_to) references public.profile_store_memberships(organization_id,store_id,profile_id);
alter table public.sales drop constraint sales_organization_id_store_id_seller_id_fkey;
alter table public.sales add constraint sales_organization_id_store_id_seller_id_fkey
 foreign key(organization_id,store_id,seller_id) references public.profile_store_memberships(organization_id,store_id,profile_id);
alter table public.sales_targets drop constraint sales_targets_organization_id_store_id_seller_id_fkey;
alter table public.sales_targets add constraint sales_targets_organization_id_store_id_seller_id_fkey
 foreign key(organization_id,store_id,seller_id) references public.profile_store_memberships(organization_id,store_id,profile_id);

create function private.remember_staff_store() returns trigger
 language plpgsql security definer set search_path=pg_catalog,public as $$
 begin
 if new.store_id is not null then
 insert into public.profile_store_memberships(organization_id,store_id,profile_id,was_seller)
 values(new.organization_id,new.store_id,new.id,new.role='seller')
 on conflict(organization_id,store_id,profile_id) do update
 set was_seller=public.profile_store_memberships.was_seller or excluded.was_seller;
 if nullif(trim(new.external_id),'') is not null and exists(select 1 from public.profile_store_memberships m
 where m.organization_id=new.organization_id and m.store_id=new.store_id and m.profile_id=new.id and m.was_seller) then
 -- Old codes remain aliases for historical reimports; a code cannot move to another employee.
 insert into public.profile_external_ids(organization_id,store_id,external_id,profile_id)
 values(new.organization_id,new.store_id,new.external_id,new.id)
 on conflict(organization_id,store_id,external_id) do update set profile_id=excluded.profile_id
 where public.profile_external_ids.profile_id=excluded.profile_id;
 if not found then raise exception 'Este código do PDV já pertence ao histórico de outro funcionário';end if;
 end if;end if;return new;end
$$;
create trigger remember_staff_store after insert or update of store_id,role,external_id on public.profiles
 for each row execute function private.remember_staff_store();

-- Serialize new assignment against role/store/access changes of the recipient.
create function private.guard_pending_assignment() returns trigger
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare recipient public.profiles;begin
 if new.status='pending' and new.assigned_to is not null and
 (tg_op='INSERT' or old.assigned_to is distinct from new.assigned_to or old.store_id is distinct from new.store_id or old.status<>'pending') then
 select * into recipient from public.profiles where id=new.assigned_to for share;
 if not found or not recipient.is_active or recipient.role<>'seller' or recipient.organization_id<>new.organization_id or recipient.store_id<>new.store_id
 then raise exception 'Vendedor atribuído deve estar ativo no mesmo quiosque';end if;end if;
 return new;end
$$;
create trigger guard_pending_assignment before insert or update on public.contact_tasks
 for each row execute function private.guard_pending_assignment();

-- All role/access administration takes the same organization lock BEFORE profiles.
-- The actor is read again with a row lock after waiting, without STABLE JWT helpers.
create function private.lock_staff_actor() returns public.profiles
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;org uuid;begin
 select p.organization_id into org from public.profiles p where p.id=auth.uid();
 if org is null then raise exception 'Conta sem acesso ativo' using errcode='42501';end if;
 -- Serialize administration without blocking KEY SHARE locks from audit/data FKs.
 perform 1 from public.organizations where id=org for no key update;
 select * into actor from public.profiles where id=auth.uid() for update;
 if not found or not actor.is_active or actor.organization_id<>org then raise exception 'Conta sem acesso ativo' using errcode='42501';end if;
 return actor;end
$$;

create function public.change_staff_role(p_profile_id uuid,p_role text,p_store_id uuid default null) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;target public.profiles;result public.profiles;begin
 actor=private.lock_staff_actor();
 if actor.role<>'admin' then raise exception 'Somente administradores podem alterar funções' using errcode='42501';end if;
 select * into target from public.profiles where id=p_profile_id and organization_id=actor.organization_id for update;
 if not found or target.organization_id<>actor.organization_id then raise exception 'Perfil não autorizado' using errcode='42501';end if;
 if p_role is null or p_role not in ('admin','manager','seller')
 or (p_role='admin' and p_store_id is not null)
 or (p_role in ('manager','seller') and (p_store_id is null or not exists(select 1 from public.stores where id=p_store_id and organization_id=actor.organization_id)))
 then raise exception 'Função ou quiosque inválido';end if;
 if target.role='admin' and target.is_active and p_role<>'admin'
 and not exists(select 1 from public.profiles where organization_id=actor.organization_id and role='admin' and is_active and id<>target.id)
 then raise exception 'Mantenha pelo menos um administrador ativo na empresa' using detail='LAST_ACTIVE_ADMIN';end if;
 if target.role='seller' and (p_role<>'seller' or target.store_id is distinct from p_store_id) then
 update public.contact_tasks set assigned_to=null where assigned_to=target.id and status='pending';end if;
 update public.profiles set role=p_role,store_id=p_store_id where id=target.id returning * into result;
 return to_jsonb(result);end
$$;

create or replace function public.set_profile_access(p_profile_id uuid,p_active boolean) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;target public.profiles;begin
 actor=private.lock_staff_actor();
 select * into target from public.profiles where id=p_profile_id and organization_id=actor.organization_id for update;
 if not found or target.organization_id<>actor.organization_id or p_active is null
 or not (actor.role='admin' or (actor.role='manager' and target.role='seller' and target.store_id=actor.store_id))
 then raise exception 'Sem permissão para alterar este acesso' using errcode='42501';end if;
 if not p_active and target.role='admin' and target.is_active
 and not exists(select 1 from public.profiles where organization_id=actor.organization_id and role='admin' and is_active and id<>target.id)
 then raise exception 'Mantenha pelo menos um administrador ativo na empresa' using detail='LAST_ACTIVE_ADMIN';end if;
 if target.id=actor.id then raise exception 'Sem permissão para alterar este acesso' using errcode='42501';end if;
 update public.profiles set is_active=p_active where id=p_profile_id returning * into target;
 if not p_active then update public.contact_tasks set assigned_to=null where assigned_to=p_profile_id and status='pending';end if;
 return to_jsonb(target);end
$$;

create or replace function public.update_staff_profile(p_profile_id uuid,p_name text,p_handle text,p_coupon text,p_external_id text default null) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;target public.profiles;begin
 actor=private.lock_staff_actor();select * into target from public.profiles where id=p_profile_id and organization_id=actor.organization_id for update;
 if not found or target.organization_id<>actor.organization_id or not (actor.role='admin' or (actor.role='manager' and target.role='seller' and target.store_id=actor.store_id))
 then raise exception 'Sem permissão para editar este perfil' using errcode='42501';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 150 or p_handle is null or length(p_handle)>100 or p_coupon is null or length(p_coupon)>100 or length(p_external_id)>150 then raise exception 'Dados de perfil inválidos';end if;
 update public.profiles set name=trim(p_name),handle=trim(p_handle),coupon=trim(p_coupon),external_id=case when p_external_id is null then external_id else nullif(trim(p_external_id),'') end where id=p_profile_id returning * into target;return to_jsonb(target);end
$$;

create or replace function public.provision_staff(p_user_id uuid,p_store_id uuid,p_role text,p_name text,p_email text,p_cpf text default null,p_external_id text default null) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;result public.profiles;begin
 actor=private.lock_staff_actor();
 if not ((p_role='admin' and actor.role='admin' and p_store_id is null)
 or (p_role in ('manager','seller') and exists(select 1 from public.stores where id=p_store_id and organization_id=actor.organization_id)
 and (actor.role='admin' or (actor.role='manager' and p_role='seller' and actor.store_id=p_store_id))))
 then raise exception 'Sem permissão para cadastrar este perfil' using errcode='42501';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 150 or p_email is null or length(p_email)>254
 or length(p_external_id)>150 or (p_cpf is not null and p_cpf !~ '^[0-9]{11}$') then raise exception 'Dados de cadastro inválidos';end if;
 if not exists(select 1 from auth.users where id=p_user_id and lower(email)=lower(trim(p_email))) then raise exception 'Convite de autenticação não encontrado';end if;
 insert into public.profiles(id,organization_id,store_id,role,name,email,cpf,external_id)
 values(p_user_id,actor.organization_id,p_store_id,p_role,trim(p_name),lower(trim(p_email)),p_cpf,nullif(trim(p_external_id),'')) returning * into result;
 return to_jsonb(result);end
$$;

-- Take the organization/profile locks before the task: completed_by has a
-- profile FK, so completing a contact must share the role-change lock order.
create or replace function public.complete_contact(p_task_id uuid,p_outcome text) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;task public.contact_tasks;begin
 actor=private.lock_staff_actor();select * into task from public.contact_tasks where id=p_task_id for update;
 if not found or task.organization_id<>actor.organization_id or not coalesce(actor.role='admin' or (actor.store_id=task.store_id and (actor.role='manager' or task.assigned_to=actor.id)),false) then raise exception 'Contato indisponível' using errcode='42501';end if;
 if p_outcome is null or p_outcome not in ('contacted','no_response','invalid_number','opt_out') then raise exception 'Informe um resultado de contato válido';end if;
 if task.status='completed' then return to_jsonb(task);end if;
 if p_outcome<>'opt_out' and exists(select 1 from public.customers c where c.id=task.customer_id and c.do_not_contact) then raise exception 'Cliente não autoriza novos contatos';end if;
 if p_outcome='opt_out' then update public.customers set do_not_contact=true,updated_at=now() where id=task.customer_id;end if;
 update public.contact_tasks set status='completed',outcome=trim(p_outcome),completed_by=auth.uid(),completed_at=now() where id=p_task_id returning * into task;
 return to_jsonb(task);end
$$;

-- A narrow history-name projection supports authorized sales reports without
-- granting managers SELECT on an administrator's email, role or complete profile.
create function private.report_staff(p_store_id uuid default null)
 returns table(seller_id uuid,store_id uuid,name text)
 language plpgsql stable security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;begin
 perform private.require_active();select * into actor from public.profiles where id=auth.uid();
 if p_store_id is not null and not private.can_store(p_store_id) then raise exception 'Quiosque não autorizado' using errcode='42501';end if;
 return query select m.profile_id,m.store_id,p.name from public.profile_store_memberships m join public.profiles p on p.id=m.profile_id
 where m.organization_id=actor.organization_id and m.was_seller and private.can_store(m.store_id)
 and (p_store_id is null or m.store_id=p_store_id) and (actor.role<>'seller' or m.profile_id=actor.id);end
$$;

create or replace function private.validate_report_filters(p_store_id uuid,p_from date,p_to date,p_seller_id uuid,p_agenda_id uuid,p_minimum numeric) returns void
 language plpgsql stable security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;begin
 perform private.require_active();select * into actor from public.profiles where id=auth.uid();
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Período inválido (máximo 10 anos)';end if;
 if p_store_id is not null and not private.can_store(p_store_id) then raise exception 'Quiosque não autorizado' using errcode='42501';end if;
 if p_minimum is null or p_minimum<0 or p_minimum>999999999999.99 or p_minimum='NaN'::numeric then raise exception 'Venda mínima inválida';end if;
 if p_seller_id is not null and not exists(select 1 from public.profile_store_memberships m where m.profile_id=p_seller_id and m.organization_id=actor.organization_id and m.was_seller
 and private.can_store(m.store_id) and (p_store_id is null or m.store_id=p_store_id) and (actor.role<>'seller' or m.profile_id=actor.id))
 then raise exception 'Vendedor não autorizado' using errcode='42501';end if;
 if p_agenda_id is not null and not exists(select 1 from public.agendas where id=p_agenda_id and organization_id=actor.organization_id) then raise exception 'Agenda não autorizada' using errcode='42501';end if;
 end
$$;

create or replace function public.import_presence_batch(p_store_id uuid,p_payload jsonb) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare org uuid;row jsonb;customer uuid;seller uuid;customer_count integer=0;sale_count integer=0;run uuid;begin
 perform private.require_active();org=private.current_org();
 if not private.can_manage(p_store_id) then raise exception 'Sem permissão para importar neste quiosque' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('customers','sales'))
 or jsonb_typeof(coalesce(p_payload->'customers','[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_payload->'sales','[]'::jsonb))<>'array'
 then raise exception 'Lote inválido: informe customers e sales como listas';end if;
 if jsonb_array_length(coalesce(p_payload->'customers','[]'))+jsonb_array_length(coalesce(p_payload->'sales','[]'))>5000 then raise exception 'Limite de 5000 registros por lote';end if;
 for row in select value from jsonb_array_elements(coalesce(p_payload->'customers','[]')) loop
 if jsonb_typeof(row)<>'object' or exists(select 1 from jsonb_object_keys(row) k where k not in ('external_id','name','phone','birth_date','responsible_external_id'))
 or length(trim(coalesce(row->>'external_id','')))=0 or length(trim(coalesce(row->>'name','')))=0 or length(row->>'external_id')>150 or length(row->>'name')>150
 or length(coalesce(row->>'phone',''))>40 then raise exception 'Cadastro de cliente inválido';end if;
 seller=null;
 if nullif(row->>'responsible_external_id','') is not null then
 select profile_id into seller from public.profile_external_ids where organization_id=org and store_id=p_store_id and external_id=row->>'responsible_external_id';
 if seller is null then raise exception 'Código do vendedor responsável não encontrado';end if;
 end if;
 insert into public.customers(organization_id,store_id,external_id,name,phone,birth_date,responsible_id)
 values(org,p_store_id,trim(row->>'external_id'),trim(row->>'name'),nullif(row->>'phone',''),nullif(row->>'birth_date','')::date,seller)
 on conflict(organization_id,store_id,external_id) do update set name=excluded.name,phone=case when row ? 'phone' then excluded.phone else public.customers.phone end,
 birth_date=case when row ? 'birth_date' then excluded.birth_date else public.customers.birth_date end,
 responsible_id=coalesce(excluded.responsible_id,public.customers.responsible_id),updated_at=now();customer_count=customer_count+1;
 end loop;
 for row in select value from jsonb_array_elements(coalesce(p_payload->'sales','[]')) loop
 if jsonb_typeof(row)<>'object' or exists(select 1 from jsonb_object_keys(row) k where k not in ('external_id','customer_external_id','seller_external_id','sold_at','gross_amount','discount_amount','returned_amount','status'))
 or length(trim(coalesce(row->>'external_id','')))=0 or length(row->>'external_id')>150 or nullif(row->>'sold_at','') is null
 or (row->>'gross_amount') is null then raise exception 'Venda inválida';end if;
 if (row->>'sold_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Data da venda deve incluir fuso horário';end if;
 customer=null;seller=null;
 if nullif(row->>'customer_external_id','') is not null then
 select id into customer from public.customers where organization_id=org and store_id=p_store_id and external_id=row->>'customer_external_id';
 if customer is null then raise exception 'Cliente da venda não encontrado';end if;
 end if;
 if nullif(row->>'seller_external_id','') is not null then
 select profile_id into seller from public.profile_external_ids where organization_id=org and store_id=p_store_id and external_id=row->>'seller_external_id';
 if seller is null then raise exception 'Código do vendedor da venda não encontrado';end if;
 end if;
 insert into public.sales(organization_id,store_id,external_id,customer_id,seller_id,sold_at,gross_amount,discount_amount,returned_amount,status)
 values(org,p_store_id,trim(row->>'external_id'),customer,seller,(row->>'sold_at')::timestamptz,(row->>'gross_amount')::numeric,
 coalesce(nullif(row->>'discount_amount','')::numeric,0),coalesce(nullif(row->>'returned_amount','')::numeric,0),coalesce(nullif(row->>'status',''),'completed'))
 on conflict(organization_id,store_id,external_id) do update set customer_id=case when row ? 'customer_external_id' then excluded.customer_id else public.sales.customer_id end,
 seller_id=case when row ? 'seller_external_id' then excluded.seller_id else public.sales.seller_id end,sold_at=excluded.sold_at,
 gross_amount=excluded.gross_amount,
 discount_amount=case when row ? 'discount_amount' then excluded.discount_amount else public.sales.discount_amount end,
 returned_amount=case when row ? 'returned_amount' then excluded.returned_amount else public.sales.returned_amount end,
 status=case when row ? 'status' then excluded.status else public.sales.status end,updated_at=now();sale_count=sale_count+1;
 end loop;
 -- Recompute ownership from the latest still-valid purchase, including changed/cancelled sales.
 update public.customers c set last_purchase_at=latest.sold_at,responsible_id=latest.seller_id,updated_at=now()
 from (select distinct on (customer_id) customer_id,sold_at,seller_id from public.sales
 where organization_id=org and store_id=p_store_id and status='completed' and customer_id is not null and returned_amount<gross_amount
 order by customer_id,sold_at desc,id desc) latest
 where c.id=latest.customer_id and c.organization_id=org and c.store_id=p_store_id;
 -- Existing ownership imported with no sales is retained; cancelled known purchase clears its stale owner.
 update public.customers c set last_purchase_at=null,responsible_id=null,updated_at=now()
 where c.organization_id=org and c.store_id=p_store_id and c.last_purchase_at is not null

 and not exists(select 1 from public.sales s where s.customer_id=c.id and s.status='completed' and s.returned_amount<s.gross_amount);
 insert into public.sync_runs(organization_id,store_id,provider,status,finished_at,records_processed,message)
 values(org,p_store_id,'manual_csv','completed',now(),customer_count+sale_count,'Importação normalizada concluída') returning id into run;
 return jsonb_build_object('customers',customer_count,'sales',sale_count,'sync_id',run);end
$$;

create or replace function public.assign_contacts(p_store_id uuid,p_agenda_id uuid,p_quantity integer,p_seller_ids uuid[]) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare org uuid;actor public.profiles;selected_ids uuid[];task uuid;n integer=0;target uuid;begin
 actor=private.lock_staff_actor();org=actor.organization_id;
 if not ((actor.role='admin' and exists(select 1 from public.stores where id=p_store_id and organization_id=org)) or (actor.role='manager' and actor.store_id=p_store_id)) then raise exception 'Sem permissão para distribuir contatos' using errcode='42501';end if;
 if p_quantity is null or p_quantity<1 or p_quantity>5000 then raise exception 'Quantidade deve estar entre 1 e 5000';end if;
 if coalesce(cardinality(p_seller_ids),0)=0 or cardinality(p_seller_ids)<>(select count(distinct x) from unnest(p_seller_ids) x)
 or exists(select 1 from unnest(p_seller_ids) x where x is null or not exists(select 1 from public.profiles p where p.id=x and p.organization_id=org and p.store_id=p_store_id and p.role='seller' and p.is_active))
 then raise exception 'Selecione vendedores ativos do mesmo quiosque';end if;
 if not exists(select 1 from public.agendas where id=p_agenda_id and organization_id=org and is_active) then raise exception 'Agenda inválida';end if;
 select array_agg(id order by due_date,id) into selected_ids from (
 select id,due_date from public.contact_tasks where organization_id=org and store_id=p_store_id and agenda_id=p_agenda_id and status='pending' and assigned_to is null
 order by due_date,id for update skip locked limit p_quantity) q;
 if coalesce(cardinality(selected_ids),0)<p_quantity then raise exception 'Não há contatos disponíveis suficientes';end if;
 foreach task in array selected_ids loop
 target=p_seller_ids[(n % cardinality(p_seller_ids))+1];
 update public.contact_tasks set assigned_to=target where id=task;n=n+1;
 end loop;
 return jsonb_build_object('assigned',n,'task_ids',to_jsonb(selected_ids));end
$$;

create or replace function public.generate_agenda_tasks(p_store_id uuid,p_agenda_id uuid) returns integer
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;org uuid;kind text;today date;inserted integer;begin
 actor=private.lock_staff_actor();org=actor.organization_id;
 if not ((actor.role='admin' and exists(select 1 from public.stores where id=p_store_id and organization_id=org)) or (actor.role='manager' and actor.store_id=p_store_id)) then raise exception 'Sem permissão para gerar contatos' using errcode='42501';end if;
 select a.kind into kind from public.agendas a where a.id=p_agenda_id and a.organization_id=org and a.is_active;
 if not found then raise exception 'Agenda indisponível';end if;
 select (now() at time zone o.timezone)::date into today from public.organizations o where o.id=org;
 insert into public.contact_tasks(organization_id,store_id,agenda_id,customer_id,assigned_to,due_date)
 select org,p_store_id,p_agenda_id,c.id,
 case when exists(select 1 from public.profiles p where p.id=c.responsible_id and p.is_active and p.role='seller' and p.organization_id=org and p.store_id=p_store_id) then c.responsible_id else null end,today
 from public.customers c where c.organization_id=org and c.store_id=p_store_id and not c.do_not_contact and nullif(trim(c.phone),'') is not null
 and (kind in ('custom','manual')
   or (kind='birthday' and extract(month from c.birth_date)=extract(month from today) and extract(day from c.birth_date)=extract(day from today))
   or (kind='post_sale' and (c.last_purchase_at at time zone (select timezone from public.organizations where id=org))::date=today-1)
   or (kind='reactivation' and (c.last_purchase_at at time zone (select timezone from public.organizations where id=org))::date<=today-60))
 and not exists(select 1 from public.contact_tasks t where t.customer_id=c.id and t.agenda_id=p_agenda_id and
 (t.status='pending' or t.due_date>=today-15))
 on conflict(organization_id,store_id,agenda_id,customer_id,due_date) do nothing;
 get diagnostics inserted=row_count;return inserted;end
$$;

create or replace function public.report_snapshot(p_store_id uuid,p_from date,p_to date,p_seller_id uuid default null,p_agenda_id uuid default null,p_minimum numeric default 0) returns jsonb
 language plpgsql stable security invoker set search_path=pg_catalog,public as $$
 declare result jsonb;tz text;assisted jsonb;today date;begin
 perform private.require_active();
 perform private.validate_report_filters(p_store_id,p_from,p_to,p_seller_id,p_agenda_id,p_minimum);
 select timezone into tz from public.organizations where id=private.current_org();
 today=(current_timestamp at time zone tz)::date;
 with staff_history as materialized (
 select * from private.report_staff(p_store_id)
 ), report_people as materialized (
 select distinct seller_id as id,name from staff_history
 ), current_sales as materialized (
 select s.*,(s.sold_at at time zone tz)::date as sale_day from public.sales s
 where s.status='completed' and (p_store_id is null or s.store_id=p_store_id)
 and (p_seller_id is null or s.seller_id=p_seller_id) and s.gross_amount>=p_minimum
 and (p_agenda_id is null or private.sale_agenda(s.id)=p_agenda_id)
 and (s.sold_at at time zone tz)::date between p_from and p_to
 ), previous_sales as materialized (
 select s.* from public.sales s where s.status='completed' and (p_store_id is null or s.store_id=p_store_id)
 and (p_seller_id is null or s.seller_id=p_seller_id) and s.gross_amount>=p_minimum
 and (p_agenda_id is null or private.sale_agenda(s.id)=p_agenda_id)
 and (s.sold_at at time zone tz)::date between p_from-364 and p_to-364
 ), recent_sales as materialized (
 select s.*,(s.sold_at at time zone tz)::date as sale_day from public.sales s
 where s.status='completed' and (p_store_id is null or s.store_id=p_store_id)
 and (p_seller_id is null or s.seller_id=p_seller_id) and s.gross_amount>=p_minimum
 and (p_agenda_id is null or private.sale_agenda(s.id)=p_agenda_id)
 and (s.sold_at at time zone tz)::date between today-1 and today
 ), tasks as materialized (
 select t.* from public.contact_tasks t where (p_store_id is null or t.store_id=p_store_id) and t.due_date between p_from and p_to
 and (p_seller_id is null or t.assigned_to=p_seller_id) and (p_agenda_id is null or t.agenda_id=p_agenda_id)
 ), contacted as materialized (
 select distinct t.customer_id,t.store_id from public.contact_tasks t where t.status='completed' and t.outcome='contacted' and (p_store_id is null or t.store_id=p_store_id)
 and (t.completed_at at time zone tz)::date between p_from and p_to
 and (p_seller_id is null or t.completed_by=p_seller_id) and (p_agenda_id is null or t.agenda_id=p_agenda_id)
 ), converted as materialized (
 select distinct t.customer_id from public.contact_tasks t join public.sales s on s.customer_id=t.customer_id and s.store_id=t.store_id and s.status='completed'
 and s.sold_at>=t.completed_at and s.sold_at<=t.completed_at+interval '15 days' and s.returned_amount<s.gross_amount
 and s.gross_amount>=p_minimum and (p_seller_id is null or s.seller_id=p_seller_id)
 where t.status='completed' and t.outcome='contacted' and (p_store_id is null or t.store_id=p_store_id) and (t.completed_at at time zone tz)::date between p_from and p_to
 and (p_seller_id is null or t.completed_by=p_seller_id) and (p_agenda_id is null or t.agenda_id=p_agenda_id)
 ), attributed as materialized (
 select s.*,private.sale_agenda(s.id) as agenda_id from current_sales s
 ), previous_attributed as materialized (
 select s.*,private.sale_agenda(s.id) as agenda_id from previous_sales s
 ), seller_rows as (
 select p.id as seller_id,p.name,
 coalesce((select sum(s.gross_amount) from current_sales s where s.seller_id=p.id),0) as gross,
 coalesce((select sum(s.gross_amount) from previous_sales s where s.seller_id=p.id),0) as previous_gross,
 coalesce((select sum(s.returned_amount) from current_sales s where s.seller_id=p.id),0) as returns,
 (select count(*) from current_sales s where s.seller_id=p.id) as orders,
 (select count(*) from tasks t where t.assigned_to=p.id) as contacts_available,
 (select count(*) from tasks t where t.assigned_to=p.id and t.status='completed') as contacts_completed,
 (select count(*) from tasks t where t.assigned_to=p.id and t.source='Preferencial') as available_preferencial,
 (select count(*) from tasks t where t.assigned_to=p.id and t.source='Preferencial' and t.status='completed') as completed_preferencial,
 (select count(*) from tasks t where t.assigned_to=p.id and t.source='Gotas' and t.status='completed') as completed_gotas
 from report_people p where p_seller_id is null or p.id=p_seller_id
 ), agenda_rows as (
 select a.id as agenda_id,a.name,
 coalesce((select sum(s.gross_amount) from attributed s where s.agenda_id=a.id),0) as gross,
 coalesce((select sum(s.gross_amount) from previous_attributed s where s.agenda_id=a.id),0) as previous_gross,
 -- Closing-seller/store breakdowns are manager/admin only. A seller's assistance
 -- aggregate must never reveal another closing seller's identity or performance.
 case when private.current_role()='seller' then '[]'::jsonb else coalesce((
 select jsonb_agg(jsonb_build_object('seller_id',r.seller_id,'name',coalesce(p.name,'Sem vendedor cadastrado'),
 'gross',r.gross,'previous_gross',r.previous_gross) order by r.gross desc,r.seller_id)
 from (select v.seller_id,sum(v.gross) as gross,sum(v.previous_gross) as previous_gross from (
 select s.seller_id,s.gross_amount as gross,0::numeric as previous_gross from attributed s where s.agenda_id=a.id
 union all
 select s.seller_id,0::numeric,s.gross_amount from previous_attributed s where s.agenda_id=a.id
 ) v group by v.seller_id) r left join report_people p on p.id=r.seller_id
 ),'[]'::jsonb) end as by_seller,
 case when private.current_role()='seller' then '[]'::jsonb else coalesce((
 select jsonb_agg(jsonb_build_object('store_id',r.store_id,'name',st.name,
 'gross',r.gross,'previous_gross',r.previous_gross) order by st.name)
 from (select v.store_id,sum(v.gross) as gross,sum(v.previous_gross) as previous_gross from (
 select s.store_id,s.gross_amount as gross,0::numeric as previous_gross from attributed s where s.agenda_id=a.id
 union all
 select s.store_id,0::numeric,s.gross_amount from previous_attributed s where s.agenda_id=a.id
 ) v group by v.store_id) r join public.stores st on st.id=r.store_id
 ),'[]'::jsonb) end as by_store,
 (select count(*) from attributed s where s.agenda_id=a.id) as orders,
 (select count(*) from tasks t where t.agenda_id=a.id) as contacts_available,
 (select count(*) from tasks t where t.agenda_id=a.id and t.status='completed') as contacts_completed
 from public.agendas a where p_agenda_id is null or a.id=p_agenda_id
 ), store_rows as (
 select st.id as store_id,st.name,
 coalesce((select sum(s.gross_amount) from current_sales s where s.store_id=st.id),0) as gross,
 coalesce((select sum(s.gross_amount) from previous_sales s where s.store_id=st.id),0) as previous_gross,
 coalesce((select sum(s.returned_amount) from current_sales s where s.store_id=st.id),0) as returns,
 (select count(*) from current_sales s where s.store_id=st.id) as orders
 from public.stores st where p_store_id is null or st.id=p_store_id
 ), day_rows as (
 select sale_day as date,sum(gross_amount) as gross,sum(returned_amount) as returns,count(*) as orders from current_sales group by sale_day order by sale_day
 )
 select jsonb_build_object(
 'profile',(select to_jsonb(p) from public.profiles p where p.id=auth.uid()),
 'stores',coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from public.stores s),'[]'::jsonb),
 'profiles',coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from public.profiles p where p_store_id is null or p.store_id=p_store_id or p.id=auth.uid() or p.role='admin'),'[]'::jsonb),
 'agendas',coalesce((select jsonb_agg(to_jsonb(a) order by a.name) from public.agendas a),'[]'::jsonb),
 'totals',jsonb_build_object(
 'gross',coalesce((select sum(gross_amount) from current_sales),0),'revenue',coalesce((select sum(gross_amount) from current_sales),0),
 'returns',coalesce((select sum(returned_amount) from current_sales),0),'orders',(select count(*) from current_sales),
 'previous_gross',coalesce((select sum(gross_amount) from previous_sales),0),
 'today_gross',coalesce((select sum(gross_amount) from recent_sales where sale_day=today),0),
 'yesterday_gross',coalesce((select sum(gross_amount) from recent_sales where sale_day=today-1),0),
 'contacts_available',(select count(*) from tasks),'contacts_completed',(select count(*) from tasks where status='completed'),
 'customers_contacted',(select count(*) from contacted),'converted_customers',(select count(*) from converted),
 'conversion',case when (select count(*) from contacted)=0 then null else 100.0*(select count(*) from converted)/(select count(*) from contacted) end,
 'attributed_gross',coalesce((select sum(gross_amount) from attributed where agenda_id is not null),0)),
 'by_seller',coalesce((select jsonb_agg(to_jsonb(r) order by r.gross desc) from seller_rows r),'[]'::jsonb),
 'by_agenda',coalesce((select jsonb_agg(to_jsonb(r) order by r.gross desc) from agenda_rows r),'[]'::jsonb),
 'by_store',coalesce((select jsonb_agg(to_jsonb(r) order by r.name) from store_rows r),'[]'::jsonb),
 'by_day',coalesce((select jsonb_agg(to_jsonb(r) order by r.date) from day_rows r),'[]'::jsonb),
 'latest_sync',(select to_jsonb(r) from public.sync_runs r where p_store_id is null or r.store_id=p_store_id order by r.started_at desc limit 1),
 'targets',coalesce((select jsonb_agg(to_jsonb(t)) from public.sales_targets t where (p_store_id is null or t.store_id=p_store_id)
 and (p_seller_id is null or t.seller_id=p_seller_id)
 and t.period_start between date_trunc('month',p_from)::date and date_trunc('month',p_to)::date),'[]'::jsonb)
 ) into result;
 if private.current_role()='seller' then
 assisted=private.seller_contact_metrics(p_store_id,p_from,p_to,p_seller_id,p_agenda_id,p_minimum);
 result=jsonb_set(result,'{totals,customers_contacted}',assisted->'customers_contacted');
 result=jsonb_set(result,'{totals,converted_customers}',assisted->'converted_customers');
 result=jsonb_set(result,'{totals,attributed_gross}',assisted->'attributed_gross');
 result=jsonb_set(result,'{totals,conversion}',case when (assisted->>'customers_contacted')::numeric=0 then 'null'::jsonb
 else to_jsonb(100.0*(assisted->>'converted_customers')::numeric/(assisted->>'customers_contacted')::numeric) end);
 result=jsonb_set(result,'{by_agenda}',coalesce((select jsonb_agg(
 jsonb_set(jsonb_set(jsonb_set(a.value,'{gross}',coalesce((select m.value->'gross' from jsonb_array_elements(assisted->'by_agenda') m where m.value->>'agenda_id'=a.value->>'agenda_id'),'0'::jsonb)),
 '{orders}',coalesce((select m.value->'orders' from jsonb_array_elements(assisted->'by_agenda') m where m.value->>'agenda_id'=a.value->>'agenda_id'),'0'::jsonb)),
 '{previous_gross}',coalesce((select m.value->'previous_gross' from jsonb_array_elements(assisted->'by_agenda') m where m.value->>'agenda_id'=a.value->>'agenda_id'),'0'::jsonb)))
 from jsonb_array_elements(result->'by_agenda') a),'[]'::jsonb));
 end if;
 return result;end
$$;

revoke all on function private.remember_staff_store(),private.guard_pending_assignment(),private.lock_staff_actor(),private.report_staff(uuid) from public,anon,authenticated;
grant execute on function private.report_staff(uuid) to authenticated,service_role;
revoke all on function public.change_staff_role(uuid,text,uuid) from public,anon;
grant execute on function public.change_staff_role(uuid,text,uuid) to authenticated;
-- Replaced existing functions retain their original grants.
commit;
