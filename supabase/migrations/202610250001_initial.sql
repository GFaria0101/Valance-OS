-- Valance OS: tenant- and store-scoped operational database.
-- Apply using the Supabase migration runner / trusted SQL editor.
begin;
revoke create on schema public from public,anon,authenticated;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table public.organizations (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 150),
 timezone text not null default 'America/Sao_Paulo', created_at timestamptz not null default now()
);
create table public.stores (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 1 and 150), external_id text,
 created_at timestamptz not null default now(), unique(organization_id,id),unique(organization_id,external_id)
);
create table public.profiles (
 id uuid primary key references auth.users(id), organization_id uuid not null references public.organizations(id),
 store_id uuid,role text not null check(role in ('admin','manager','seller')),name text not null check(length(trim(name)) between 1 and 150),
 email text not null,cpf text,handle text not null default '',coupon text not null default '',external_id text,
 is_active boolean not null default true,created_at timestamptz not null default now(),
 check ((role='admin' and store_id is null) or (role in ('manager','seller') and store_id is not null)),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 unique(organization_id,id),unique(organization_id,store_id,id),unique(organization_id,store_id,external_id)
);
create table public.customers (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),store_id uuid not null,
 external_id text not null,name text not null check(length(trim(name)) between 1 and 150),phone text,birth_date date,
 last_purchase_at timestamptz,responsible_id uuid,do_not_contact boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,store_id,responsible_id) references public.profiles(organization_id,store_id,id),
 unique(organization_id,store_id,id),unique(organization_id,store_id,external_id)
);
create table public.agendas (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 1 and 150),kind text not null default 'custom',is_active boolean not null default true,
 created_at timestamptz not null default now(),unique(organization_id,id)
);
create table public.contact_tasks (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),store_id uuid not null,
 agenda_id uuid not null,customer_id uuid not null,assigned_to uuid,status text not null default 'pending' check(status in ('pending','completed')),
 source text not null default 'Preferencial' check(source in ('Preferencial','Gotas')),due_date date not null,
 outcome text,completed_by uuid,completed_at timestamptz,created_at timestamptz not null default now(),
 check((status='pending' and completed_at is null and completed_by is null) or (status='completed' and completed_at is not null and completed_by is not null)),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,agenda_id) references public.agendas(organization_id,id),
 foreign key(organization_id,store_id,customer_id) references public.customers(organization_id,store_id,id),
 foreign key(organization_id,store_id,assigned_to) references public.profiles(organization_id,store_id,id),
 foreign key(organization_id,completed_by) references public.profiles(organization_id,id),
 unique(organization_id,store_id,agenda_id,customer_id,due_date)
);
create table public.sales (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),store_id uuid not null,
 external_id text not null,customer_id uuid,seller_id uuid,sold_at timestamptz not null,
 gross_amount numeric(14,2) not null check(gross_amount>=0 and gross_amount<>'NaN'::numeric),discount_amount numeric(14,2) not null default 0 check(discount_amount>=0 and discount_amount<=gross_amount and discount_amount<>'NaN'::numeric),
 status text not null default 'completed' check(status in ('completed','cancelled')),returned_amount numeric(14,2) not null default 0 check(returned_amount>=0 and returned_amount<=gross_amount and returned_amount<>'NaN'::numeric),
 updated_at timestamptz not null default now(),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,store_id,customer_id) references public.customers(organization_id,store_id,id),
 foreign key(organization_id,store_id,seller_id) references public.profiles(organization_id,store_id,id),
 unique(organization_id,store_id,external_id)
);
create table public.sales_targets (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),store_id uuid not null,seller_id uuid,
 period_start date not null check(extract(day from period_start)=1),amount numeric(14,2) not null check(amount>=0 and amount<>'NaN'::numeric),
 updated_at timestamptz not null default now(),
 foreign key(organization_id,store_id) references public.stores(organization_id,id),
 foreign key(organization_id,store_id,seller_id) references public.profiles(organization_id,store_id,id)
);
create unique index sales_targets_scope on public.sales_targets(store_id,coalesce(seller_id,'00000000-0000-0000-0000-000000000000'::uuid),period_start);
create table public.sync_runs (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),store_id uuid,
 provider text not null default 'presence',status text not null check(status in ('running','completed','failed','blocked')),
 started_at timestamptz not null default now(),finished_at timestamptz,records_processed integer not null default 0 check(records_processed>=0),message text,
 foreign key(organization_id,store_id) references public.stores(organization_id,id)
);
create table public.audit_log (
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id),store_id uuid,
 actor_id uuid,entity text not null,entity_id text not null,action text not null,created_at timestamptz not null default now(),
 foreign key(organization_id,store_id) references public.stores(organization_id,id)
);
create index tasks_assignment on public.contact_tasks(assigned_to,due_date,status);
create index tasks_store_pending on public.contact_tasks(store_id,due_date) where status='pending';
create index tasks_attribution on public.contact_tasks(customer_id,completed_at desc) where status='completed';
create index sales_period on public.sales(store_id,sold_at);
create index customers_responsible on public.customers(responsible_id);

-- All access helpers derive identity from the signed JWT; parameters cannot choose a user.
create function private.current_org() returns uuid language sql stable security definer set search_path=pg_catalog,public as $$
 select organization_id from public.profiles where id=auth.uid() and is_active
$$;
create function private.current_role() returns text language sql stable security definer set search_path=pg_catalog,public as $$
 select role from public.profiles where id=auth.uid() and is_active
$$;
create function private.can_store(p_store_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.profiles p join public.stores s on s.organization_id=p.organization_id
 where p.id=auth.uid() and p.is_active and s.id=p_store_id and (p.role='admin' or p.store_id=s.id))
$$;
create function private.can_manage(p_store_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.profiles p join public.stores s on s.organization_id=p.organization_id
 where p.id=auth.uid() and p.is_active and s.id=p_store_id and (p.role='admin' or (p.role='manager' and p.store_id=s.id)))
$$;
create function private.require_active() returns void language plpgsql stable security definer set search_path=pg_catalog,public as $$
 begin if not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception 'Conta sem acesso ativo' using errcode='42501';end if;end
$$;

alter table public.organizations enable row level security;
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.agendas enable row level security;
alter table public.contact_tasks enable row level security;
alter table public.sales enable row level security;
alter table public.sales_targets enable row level security;
alter table public.sync_runs enable row level security;
alter table public.audit_log enable row level security;
create policy read_org on public.organizations for select to authenticated using(id=private.current_org());
create policy read_stores on public.stores for select to authenticated using(private.can_store(id));
create policy read_profiles on public.profiles for select to authenticated using(organization_id=private.current_org() and (id=auth.uid() or private.current_role()='admin' or (role='seller' and private.can_manage(store_id))));
create policy read_agendas on public.agendas for select to authenticated using(organization_id=private.current_org());
create policy read_tasks on public.contact_tasks for select to authenticated using(organization_id=private.current_org() and private.can_store(store_id) and (private.can_manage(store_id) or assigned_to=auth.uid()));
create policy read_customers on public.customers for select to authenticated using(organization_id=private.current_org() and private.can_store(store_id) and (private.can_manage(store_id) or responsible_id=auth.uid() or exists(select 1 from public.contact_tasks t where t.customer_id=customers.id and t.assigned_to=auth.uid())));
create policy read_sales on public.sales for select to authenticated using(organization_id=private.current_org() and private.can_store(store_id) and (private.can_manage(store_id) or seller_id=auth.uid()));
create policy read_targets on public.sales_targets for select to authenticated using(organization_id=private.current_org() and private.can_store(store_id) and (private.can_manage(store_id) or seller_id=auth.uid()));
create policy read_sync on public.sync_runs for select to authenticated using(organization_id=private.current_org() and (private.current_role()='admin' or private.can_store(store_id)));
create policy read_audit on public.audit_log for select to authenticated using(organization_id=private.current_org() and (private.current_role()='admin' or private.can_manage(store_id)));

create function private.write_audit() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
 declare r jsonb;begin
 r=to_jsonb(new);
 insert into public.audit_log(organization_id,store_id,actor_id,entity,entity_id,action)
 values((r->>'organization_id')::uuid,(r->>'store_id')::uuid,auth.uid(),tg_table_name,r->>'id',tg_op);
 return new;end
$$;
create trigger audit_profile after insert or update on public.profiles for each row execute function private.write_audit();
create trigger audit_tasks after insert or update on public.contact_tasks for each row execute function private.write_audit();
create trigger audit_targets after insert or update on public.sales_targets for each row execute function private.write_audit();
create trigger audit_customers after insert or update on public.customers for each row execute function private.write_audit();
create trigger audit_sales after insert or update on public.sales for each row execute function private.write_audit();

-- SECURITY DEFINER mutation functions explicitly recheck identity and tenant scope.
create function public.assign_contacts(p_store_id uuid,p_agenda_id uuid,p_quantity integer,p_seller_ids uuid[]) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare org uuid;actor public.profiles;selected_ids uuid[];task uuid;n integer=0;target uuid;begin
 perform private.require_active();select * into actor from public.profiles where id=auth.uid();org=actor.organization_id;
 if not private.can_manage(p_store_id) then raise exception 'Sem permissão para distribuir contatos' using errcode='42501';end if;
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
create function public.complete_contact(p_task_id uuid,p_outcome text) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare task public.contact_tasks;begin
 perform private.require_active();select * into task from public.contact_tasks where id=p_task_id for update;
 if not found or not private.can_store(task.store_id) or not (private.can_manage(task.store_id) or task.assigned_to=auth.uid()) then raise exception 'Contato indisponível' using errcode='42501';end if;
 if p_outcome is null or p_outcome not in ('contacted','no_response','invalid_number','opt_out') then raise exception 'Informe um resultado de contato válido';end if;
 if task.status='completed' then return to_jsonb(task);end if;
 if p_outcome<>'opt_out' and exists(select 1 from public.customers c where c.id=task.customer_id and c.do_not_contact) then raise exception 'Cliente não autoriza novos contatos';end if;
 if p_outcome='opt_out' then update public.customers set do_not_contact=true,updated_at=now() where id=task.customer_id;end if;
 update public.contact_tasks set status='completed',outcome=trim(p_outcome),completed_by=auth.uid(),completed_at=now() where id=p_task_id returning * into task;
 return to_jsonb(task);end
$$;
create function public.save_own_profile(p_name text,p_handle text) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare result public.profiles;begin
 perform private.require_active();
 if p_name is null or length(trim(p_name)) not between 1 and 150 or p_handle is null or length(p_handle)>100 then raise exception 'Nome ou perfil inválido';end if;
 update public.profiles set name=trim(p_name),handle=trim(p_handle) where id=auth.uid() returning * into result;
 return to_jsonb(result);end
$$;
create function public.set_profile_access(p_profile_id uuid,p_active boolean) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;target public.profiles;begin
 perform private.require_active();select * into actor from public.profiles where id=auth.uid();select * into target from public.profiles where id=p_profile_id for update;
 if not found or target.organization_id<>actor.organization_id or p_active is null or target.id=actor.id
 or not (actor.role='admin' or (actor.role='manager' and target.role='seller' and target.store_id=actor.store_id))
 then raise exception 'Sem permissão para alterar este acesso' using errcode='42501';end if;
 update public.profiles set is_active=p_active where id=p_profile_id returning * into target;
 if not p_active and target.role='seller' then update public.contact_tasks set assigned_to=null where assigned_to=p_profile_id and status='pending';end if;
 return to_jsonb(target);end
$$;
create function public.update_staff_profile(p_profile_id uuid,p_name text,p_handle text,p_coupon text,p_external_id text default null) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;target public.profiles;begin
 perform private.require_active();select * into actor from public.profiles where id=auth.uid();select * into target from public.profiles where id=p_profile_id for update;
 if not found or target.organization_id<>actor.organization_id or not (actor.role='admin' or (actor.role='manager' and target.role='seller' and target.store_id=actor.store_id))
 then raise exception 'Sem permissão para editar este perfil' using errcode='42501';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 150 or p_handle is null or length(p_handle)>100 or p_coupon is null or length(p_coupon)>100 or length(p_external_id)>150 then raise exception 'Dados de perfil inválidos';end if;
 update public.profiles set name=trim(p_name),handle=trim(p_handle),coupon=trim(p_coupon),external_id=case when p_external_id is null then external_id else nullif(trim(p_external_id),'') end where id=p_profile_id returning * into target;return to_jsonb(target);end
$$;
create function public.save_target(p_store_id uuid,p_seller_id uuid,p_period_start date,p_amount numeric) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare result public.sales_targets;org uuid;begin
 perform private.require_active();org=private.current_org();
 if not private.can_manage(p_store_id) then raise exception 'Sem permissão para alterar metas' using errcode='42501';end if;
 if p_amount is null or p_amount<0 or p_amount>999999999999.99 or p_period_start is null or extract(day from p_period_start)<>1 then raise exception 'Meta ou período inválido';end if;
 if p_seller_id is not null and not exists(select 1 from public.profiles where id=p_seller_id and organization_id=org and store_id=p_store_id and role='seller') then raise exception 'Vendedor inválido';end if;
 insert into public.sales_targets(organization_id,store_id,seller_id,period_start,amount) values(org,p_store_id,p_seller_id,p_period_start,p_amount)
 on conflict(store_id,coalesce(seller_id,'00000000-0000-0000-0000-000000000000'::uuid),period_start) do update set amount=excluded.amount,updated_at=now() returning * into result;
 return to_jsonb(result);end
$$;

create function public.import_presence_batch(p_store_id uuid,p_payload jsonb) returns jsonb
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
 select id into seller from public.profiles where organization_id=org and store_id=p_store_id and external_id=row->>'responsible_external_id' and role='seller';
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
 select id into seller from public.profiles where organization_id=org and store_id=p_store_id and external_id=row->>'seller_external_id' and role='seller';
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

create function public.generate_agenda_tasks(p_store_id uuid,p_agenda_id uuid) returns integer
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare org uuid;kind text;today date;inserted integer;begin
 perform private.require_active();org=private.current_org();
 if not private.can_manage(p_store_id) then raise exception 'Sem permissão para gerar contatos' using errcode='42501';end if;
 select a.kind into kind from public.agendas a where a.id=p_agenda_id and a.organization_id=org and a.is_active;
 if not found then raise exception 'Agenda indisponível';end if;
 select (now() at time zone o.timezone)::date into today from public.organizations o where o.id=org;
 insert into public.contact_tasks(organization_id,store_id,agenda_id,customer_id,assigned_to,due_date)
 select org,p_store_id,p_agenda_id,c.id,
 case when exists(select 1 from public.profiles p where p.id=c.responsible_id and p.is_active and p.role='seller') then c.responsible_id else null end,today
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

create function public.provision_staff(p_user_id uuid,p_store_id uuid,p_role text,p_name text,p_email text,p_cpf text default null,p_external_id text default null) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;result public.profiles;begin
 perform private.require_active();select * into actor from public.profiles where id=auth.uid();
 if not ((p_role='admin' and actor.role='admin' and p_store_id is null)
 or (p_role in ('manager','seller') and private.can_manage(p_store_id) and (actor.role='admin' or p_role='seller')))
 then raise exception 'Sem permissão para cadastrar este perfil' using errcode='42501';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 150 or p_email is null or length(p_email)>254
 or length(p_external_id)>150 or (p_cpf is not null and p_cpf !~ '^[0-9]{11}$') then raise exception 'Dados de cadastro inválidos';end if;
 if not exists(select 1 from auth.users where id=p_user_id and lower(email)=lower(trim(p_email))) then raise exception 'Convite de autenticação não encontrado';end if;
 insert into public.profiles(id,organization_id,store_id,role,name,email,cpf,external_id)
 values(p_user_id,actor.organization_id,p_store_id,p_role,trim(p_name),lower(trim(p_email)),p_cpf,nullif(trim(p_external_id),'')) returning * into result;
 return to_jsonb(result);end
$$;

-- Resolve only attribution metadata for an already authorized closing sale.
-- Unauthorized/nonexistent IDs both return NULL; other sellers' raw sales stay hidden.
create function private.sale_agenda(p_sale_id uuid) returns uuid
 language plpgsql stable security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;sale public.sales;result uuid;begin
 perform private.require_active();select * into actor from public.profiles where id=auth.uid();
 select * into sale from public.sales s where s.id=p_sale_id and s.organization_id=actor.organization_id
 and private.can_store(s.store_id) and (private.can_manage(s.store_id) or s.seller_id=actor.id);
 if not found then return null;end if;
 select t.agenda_id into result from public.contact_tasks t where t.organization_id=actor.organization_id and t.store_id=sale.store_id
 and t.customer_id=sale.customer_id and t.status='completed' and t.outcome='contacted'
 and t.completed_at<=sale.sold_at and t.completed_at>=sale.sold_at-interval '15 days'
 order by t.completed_at desc,t.id desc limit 1;return result;end
$$;
create function private.validate_report_filters(p_store_id uuid,p_from date,p_to date,p_seller_id uuid,p_agenda_id uuid,p_minimum numeric) returns void
 language plpgsql stable security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;begin
 perform private.require_active();select * into actor from public.profiles where id=auth.uid();
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>3660 then raise exception 'Período inválido (máximo 10 anos)';end if;
 if p_store_id is not null and not private.can_store(p_store_id) then raise exception 'Quiosque não autorizado' using errcode='42501';end if;
 if p_minimum is null or p_minimum<0 or p_minimum>999999999999.99 or p_minimum='NaN'::numeric then raise exception 'Venda mínima inválida';end if;
 if p_seller_id is not null and not exists(select 1 from public.profiles p where p.id=p_seller_id and p.organization_id=actor.organization_id and p.role='seller'
 and private.can_store(p.store_id) and (p_store_id is null or p.store_id=p_store_id) and (actor.role<>'seller' or p.id=actor.id))
 then raise exception 'Vendedor não autorizado' using errcode='42501';end if;
 if p_agenda_id is not null and not exists(select 1 from public.agendas where id=p_agenda_id and organization_id=actor.organization_id) then raise exception 'Agenda não autorizada' using errcode='42501';end if;
 end
$$;

-- A seller may see aggregate conversion generated by their own verified contact,
-- even when another seller closes the purchase. No other seller's sale rows or IDs are returned.
create function private.seller_contact_metrics(p_store_id uuid,p_from date,p_to date,p_seller_id uuid default null,p_agenda_id uuid default null,p_minimum numeric default 0) returns jsonb
 language plpgsql stable security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;tz text;result jsonb;begin
 perform private.require_active();select * into actor from public.profiles where id=auth.uid();
 if actor.role<>'seller' or (p_store_id is not null and p_store_id<>actor.store_id) then raise exception 'Escopo de contato não autorizado' using errcode='42501';end if;
 perform private.validate_report_filters(p_store_id,p_from,p_to,p_seller_id,p_agenda_id,p_minimum);
 select timezone into tz from public.organizations where id=actor.organization_id;
 with own_contacts as materialized (
 select t.* from public.contact_tasks t where t.organization_id=actor.organization_id and t.store_id=actor.store_id
 and t.completed_by=actor.id and t.status='completed' and t.outcome='contacted' and (p_agenda_id is null or t.agenda_id=p_agenda_id)
 and (t.completed_at at time zone tz)::date between p_from and p_to
 and (p_seller_id is null or t.completed_by=p_seller_id) and (p_agenda_id is null or t.agenda_id=p_agenda_id)
 ), converted as (
 select distinct t.customer_id from own_contacts t join public.sales s on s.organization_id=t.organization_id and s.store_id=t.store_id
 and s.customer_id=t.customer_id and s.status='completed' and s.returned_amount<s.gross_amount
 and s.sold_at>=t.completed_at and s.sold_at<=t.completed_at+interval '15 days'
 and s.gross_amount>=p_minimum and (p_seller_id is null or s.seller_id=p_seller_id)
 ), own_attributions as materialized (
 select s.gross_amount,latest.agenda_id from public.sales s
 join lateral (
 select t.agenda_id,t.completed_by from public.contact_tasks t where t.organization_id=actor.organization_id and t.store_id=actor.store_id
 and t.customer_id=s.customer_id and t.status='completed' and t.outcome='contacted'
 and t.completed_at<=s.sold_at and t.completed_at>=s.sold_at-interval '15 days'
 order by t.completed_at desc,t.id desc limit 1
 ) latest on latest.completed_by=actor.id
 where s.organization_id=actor.organization_id and s.store_id=actor.store_id and s.status='completed'
 and (p_seller_id is null or s.seller_id=p_seller_id) and (p_agenda_id is null or latest.agenda_id=p_agenda_id) and s.gross_amount>=p_minimum
 and (s.sold_at at time zone tz)::date between p_from and p_to
 ), agenda_rows as (
 select agenda_id,sum(gross_amount) as gross,count(*) as orders from own_attributions group by agenda_id
 )
 select jsonb_build_object('customers_contacted',(select count(distinct customer_id) from own_contacts),
 'converted_customers',(select count(*) from converted),'attributed_gross',coalesce((select sum(gross_amount) from own_attributions),0),
 'by_agenda',coalesce((select jsonb_agg(to_jsonb(a)) from agenda_rows a),'[]'::jsonb)) into result;
 return result;end
$$;

create function public.report_snapshot(p_store_id uuid,p_from date,p_to date,p_seller_id uuid default null,p_agenda_id uuid default null,p_minimum numeric default 0) returns jsonb
 language plpgsql stable security invoker set search_path=pg_catalog,public as $$
 declare result jsonb;tz text;assisted jsonb;begin
 perform private.require_active();
 perform private.validate_report_filters(p_store_id,p_from,p_to,p_seller_id,p_agenda_id,p_minimum);
 select timezone into tz from public.organizations where id=private.current_org();
 with current_sales as materialized (
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
 ), seller_rows as (
 select p.id as seller_id,p.name,
 coalesce((select sum(s.gross_amount) from current_sales s where s.seller_id=p.id),0) as gross,
 coalesce((select sum(s.returned_amount) from current_sales s where s.seller_id=p.id),0) as returns,
 (select count(*) from current_sales s where s.seller_id=p.id) as orders,
 (select count(*) from tasks t where t.assigned_to=p.id) as contacts_available,
 (select count(*) from tasks t where t.assigned_to=p.id and t.status='completed') as contacts_completed,
 (select count(*) from tasks t where t.assigned_to=p.id and t.source='Preferencial') as available_preferencial,
 (select count(*) from tasks t where t.assigned_to=p.id and t.source='Preferencial' and t.status='completed') as completed_preferencial,
 (select count(*) from tasks t where t.assigned_to=p.id and t.source='Gotas' and t.status='completed') as completed_gotas
 from public.profiles p where p.role='seller' and (p_store_id is null or p.store_id=p_store_id) and (p_seller_id is null or p.id=p_seller_id)
 ), agenda_rows as (
 select a.id as agenda_id,a.name,
 coalesce((select sum(s.gross_amount) from attributed s where s.agenda_id=a.id),0) as gross,
 (select count(*) from attributed s where s.agenda_id=a.id) as orders,
 (select count(*) from tasks t where t.agenda_id=a.id) as contacts_available,
 (select count(*) from tasks t where t.agenda_id=a.id and t.status='completed') as contacts_completed
 from public.agendas a where p_agenda_id is null or a.id=p_agenda_id
 ), store_rows as (
 select st.id as store_id,st.name,
 coalesce((select sum(s.gross_amount) from current_sales s where s.store_id=st.id),0) as gross,
 coalesce((select sum(s.returned_amount) from current_sales s where s.store_id=st.id),0) as returns,
 (select count(*) from current_sales s where s.store_id=st.id) as orders
 from public.stores st where p_store_id is null or st.id=p_store_id
 ), day_rows as (
 select sale_day as date,sum(gross_amount) as gross,sum(returned_amount) as returns,count(*) as orders from current_sales group by sale_day order by sale_day
 )
 select jsonb_build_object(
 'profile',(select to_jsonb(p) from public.profiles p where p.id=auth.uid()),
 'stores',coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from public.stores s),'[]'::jsonb),
 'profiles',coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from public.profiles p where p_store_id is null or p.store_id=p_store_id or p.id=auth.uid()),'[]'::jsonb),
 'agendas',coalesce((select jsonb_agg(to_jsonb(a) order by a.name) from public.agendas a),'[]'::jsonb),
 'totals',jsonb_build_object(
 'gross',coalesce((select sum(gross_amount) from current_sales),0),'revenue',coalesce((select sum(gross_amount) from current_sales),0),
 'returns',coalesce((select sum(returned_amount) from current_sales),0),'orders',(select count(*) from current_sales),
 'previous_gross',coalesce((select sum(gross_amount) from previous_sales),0),
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
 jsonb_set(jsonb_set(a.value,'{gross}',coalesce((select m.value->'gross' from jsonb_array_elements(assisted->'by_agenda') m where m.value->>'agenda_id'=a.value->>'agenda_id'),'0'::jsonb)),
 '{orders}',coalesce((select m.value->'orders' from jsonb_array_elements(assisted->'by_agenda') m where m.value->>'agenda_id'=a.value->>'agenda_id'),'0'::jsonb)))
 from jsonb_array_elements(result->'by_agenda') a),'[]'::jsonb));
 end if;
 return result;end
$$;

-- Browser clients may read only rows allowed by RLS. All business mutations use checked RPCs.
revoke all on public.organizations,public.stores,public.profiles,public.customers,public.agendas,public.contact_tasks,public.sales,public.sales_targets,public.sync_runs,public.audit_log from anon,authenticated;
grant select on public.organizations,public.stores,public.profiles,public.customers,public.agendas,public.contact_tasks,public.sales,public.sales_targets,public.sync_runs,public.audit_log to authenticated;
grant all on public.organizations,public.stores,public.profiles,public.customers,public.agendas,public.contact_tasks,public.sales,public.sales_targets,public.sync_runs,public.audit_log to service_role;
grant usage,select on all sequences in schema public to service_role;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.current_org(),private.current_role(),private.can_store(uuid),private.can_manage(uuid),private.require_active(),private.seller_contact_metrics(uuid,date,date,uuid,uuid,numeric),private.sale_agenda(uuid),private.validate_report_filters(uuid,date,date,uuid,uuid,numeric) to authenticated,service_role;
revoke all on function public.assign_contacts(uuid,uuid,integer,uuid[]),public.complete_contact(uuid,text),public.save_own_profile(text,text),public.set_profile_access(uuid,boolean),public.update_staff_profile(uuid,text,text,text,text),public.save_target(uuid,uuid,date,numeric),public.import_presence_batch(uuid,jsonb),public.generate_agenda_tasks(uuid,uuid),public.provision_staff(uuid,uuid,text,text,text,text,text),public.report_snapshot(uuid,date,date,uuid,uuid,numeric) from public,anon;
grant execute on function public.assign_contacts(uuid,uuid,integer,uuid[]),public.complete_contact(uuid,text),public.save_own_profile(text,text),public.set_profile_access(uuid,boolean),public.update_staff_profile(uuid,text,text,text,text),public.save_target(uuid,uuid,date,numeric),public.import_presence_batch(uuid,jsonb),public.generate_agenda_tasks(uuid,uuid),public.provision_staff(uuid,uuid,text,text,text,text,text),public.report_snapshot(uuid,date,date,uuid,uuid,numeric) to authenticated;

-- Supabase Realtime still applies SELECT RLS to subscribers. No public channels.
do $$ declare tab text;begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 foreach tab in array array['contact_tasks','customers','sales','profiles','sales_targets','agendas','sync_runs'] loop
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tab) then
 execute format('alter publication supabase_realtime add table public.%I',tab);end if;
 end loop;end if;end $$;
commit;
