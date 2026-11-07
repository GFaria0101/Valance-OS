-- Real report details. Existing six-argument RPC contract, RLS and own-contact
-- assistance remain intact. Amounts are not split into invented sales channels.
begin;

create or replace function private.seller_contact_metrics(p_store_id uuid,p_from date,p_to date,p_seller_id uuid default null,p_agenda_id uuid default null,p_minimum numeric default 0) returns jsonb
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
 select s.gross_amount,latest.agenda_id,(s.sold_at at time zone tz)::date as sale_day from public.sales s
 join lateral (
 select t.agenda_id,t.completed_by from public.contact_tasks t where t.organization_id=actor.organization_id and t.store_id=actor.store_id
 and t.customer_id=s.customer_id and t.status='completed' and t.outcome='contacted'
 and t.completed_at<=s.sold_at and t.completed_at>=s.sold_at-interval '15 days'
 order by t.completed_at desc,t.id desc limit 1
 ) latest on latest.completed_by=actor.id
 where s.organization_id=actor.organization_id and s.store_id=actor.store_id and s.status='completed'
 and (p_seller_id is null or s.seller_id=p_seller_id) and (p_agenda_id is null or latest.agenda_id=p_agenda_id) and s.gross_amount>=p_minimum
 and ((s.sold_at at time zone tz)::date between p_from and p_to
 or (s.sold_at at time zone tz)::date between p_from-364 and p_to-364)
 ), agenda_rows as (
 select agenda_id,coalesce(sum(gross_amount) filter(where sale_day between p_from and p_to),0) as gross,
 coalesce(sum(gross_amount) filter(where sale_day between p_from-364 and p_to-364),0) as previous_gross,
 count(*) filter(where sale_day between p_from and p_to) as orders from own_attributions group by agenda_id
 )
 select jsonb_build_object('customers_contacted',(select count(distinct customer_id) from own_contacts),
 'converted_customers',(select count(*) from converted),'attributed_gross',coalesce((select sum(gross_amount) from own_attributions where sale_day between p_from and p_to),0),
 'by_agenda',coalesce((select jsonb_agg(to_jsonb(a)) from agenda_rows a),'[]'::jsonb)) into result;
 return result;end
$$;

create or replace function public.report_snapshot(p_store_id uuid,p_from date,p_to date,p_seller_id uuid default null,p_agenda_id uuid default null,p_minimum numeric default 0) returns jsonb
 language plpgsql stable security invoker set search_path=pg_catalog,public as $$
 declare result jsonb;tz text;assisted jsonb;today date;begin
 perform private.require_active();
 perform private.validate_report_filters(p_store_id,p_from,p_to,p_seller_id,p_agenda_id,p_minimum);
 select timezone into tz from public.organizations where id=private.current_org();
 today=(current_timestamp at time zone tz)::date;
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
 from public.profiles p where p.role='seller' and (p_store_id is null or p.store_id=p_store_id) and (p_seller_id is null or p.id=p_seller_id)
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
 ) v group by v.seller_id) r left join public.profiles p on p.id=r.seller_id
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
 'profiles',coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from public.profiles p where p_store_id is null or p.store_id=p_store_id or p.id=auth.uid()),'[]'::jsonb),
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

revoke all on function private.seller_contact_metrics(uuid,date,date,uuid,uuid,numeric) from public,anon;
grant execute on function private.seller_contact_metrics(uuid,date,date,uuid,uuid,numeric) to authenticated,service_role;
revoke all on function public.report_snapshot(uuid,date,date,uuid,uuid,numeric) from public,anon;
grant execute on function public.report_snapshot(uuid,date,date,uuid,uuid,numeric) to authenticated;
commit;
