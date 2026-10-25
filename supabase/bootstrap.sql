-- Run ONLY in the trusted Supabase SQL editor after applying migrations.
-- First create the owner's Auth account in Authentication > Users (email invitation).
-- Change the email, company name and two kiosk names below before running.
-- This creates configuration only: no invented customers, sales, passwords or sales targets.
begin;
do $$
declare
 owner_email text := 'CHANGE_ME@example.com';
 company_name text := 'Minha empresa';
 kiosk_names text[] := array['Quiosque 1','Quiosque 2'];
 owner_id uuid;org uuid;
begin
 if owner_email='CHANGE_ME@example.com' then raise exception 'Configure owner_email antes de executar';end if;
 select id into owner_id from auth.users where lower(email)=lower(owner_email);
 if owner_id is null then raise exception 'Crie/convidar a conta em Authentication > Users primeiro';end if;
 if exists(select 1 from public.profiles where id=owner_id) then raise exception 'Este usuário já tem perfil. Bootstrap não será repetido.';end if;
 insert into public.organizations(name,timezone) values(company_name,'America/Sao_Paulo') returning id into org;
 insert into public.stores(organization_id,name) select org,unnest(kiosk_names);
 insert into public.profiles(id,organization_id,role,name,email)
 values(owner_id,org,'admin','Administrador',lower(owner_email));
 insert into public.agendas(organization_id,name,kind) values
 (org,'Pós-venda','post_sale'),(org,'Aniversariantes','birthday'),(org,'Reativação','reactivation'),(org,'Relacionamento','manual');
end $$;
commit;
