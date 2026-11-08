-- App presence and idle authorization are tied to the signed Auth session ID.
-- Refreshing a JWT preserves that ID; an expired app session needs a fresh login.
begin;

create table public.app_sessions (
 session_id uuid primary key,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 last_seen_at timestamptz not null default clock_timestamp(),
 last_activity_at timestamptz not null default clock_timestamp(),
 ended_at timestamptz
);
create index app_sessions_profile on public.app_sessions(profile_id) where ended_at is null;
alter table public.app_sessions enable row level security;
revoke all on public.app_sessions from public,anon,authenticated;
grant all on public.app_sessions to service_role;

create function private.app_session_id() returns uuid
 language plpgsql stable security definer set search_path=pg_catalog,public as $$
 begin
 return nullif(auth.jwt()->>'session_id','')::uuid;
 exception when invalid_text_representation then return null;
 end
$$;

-- Read the ledger directly as its owner: calling profile RLS here would recurse.
-- Presence heartbeat age affects the dot only; authorization uses real activity.
create function private.app_session_is_active() returns boolean
 language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.app_sessions s
 where s.session_id=private.app_session_id() and s.profile_id=auth.uid()
 and s.ended_at is null and s.last_activity_at>statement_timestamp()-interval '1 hour')
$$;

create or replace function private.current_org() returns uuid
 language sql stable security definer set search_path=pg_catalog,public as $$
 select organization_id from public.profiles
 where id=auth.uid() and is_active and private.app_session_is_active()
$$;
create or replace function private.current_role() returns text
 language sql stable security definer set search_path=pg_catalog,public as $$
 select role from public.profiles
 where id=auth.uid() and is_active and private.app_session_is_active()
$$;
create or replace function private.can_store(p_store_id uuid) returns boolean
 language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.profiles p join public.stores s on s.organization_id=p.organization_id
 where p.id=auth.uid() and p.is_active and private.app_session_is_active()
 and s.id=p_store_id and (p.role='admin' or p.store_id=s.id))
$$;
create or replace function private.can_manage(p_store_id uuid) returns boolean
 language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.profiles p join public.stores s on s.organization_id=p.organization_id
 where p.id=auth.uid() and p.is_active and private.app_session_is_active()
 and s.id=p_store_id and (p.role='admin' or (p.role='manager' and p.store_id=s.id)))
$$;
create or replace function private.require_active() returns void
 language plpgsql stable security definer set search_path=pg_catalog,public as $$
 begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active)
 then raise exception 'Conta sem acesso ativo' using errcode='42501';end if;
 if not private.app_session_is_active() then
 raise exception 'Sessão encerrada por inatividade. Entre novamente.' using errcode='P0001',detail='APP_SESSION_EXPIRED';
 end if;
 end
$$;

-- Staff administration otherwise reads the actor directly under its own locks.
-- Recheck the session after waiting, before any operation can use that actor.
create or replace function private.lock_staff_actor() returns public.profiles
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;org uuid;begin
 perform private.require_active();
 select p.organization_id into org from public.profiles p where p.id=auth.uid();
 if org is null then raise exception 'Conta sem acesso ativo' using errcode='42501';end if;
 perform 1 from public.organizations where id=org for no key update;
 select * into actor from public.profiles where id=auth.uid() for update;
 if not found or not actor.is_active or actor.organization_id<>org
 then raise exception 'Conta sem acesso ativo' using errcode='42501';end if;
 if not exists(select 1 from public.app_sessions s where s.session_id=private.app_session_id()
 and s.profile_id=actor.id and s.ended_at is null and s.last_activity_at>clock_timestamp()-interval '1 hour')
 then raise exception 'Sessão encerrada por inatividade. Entre novamente.' using errcode='P0001',detail='APP_SESSION_EXPIRED';end if;
 return actor;end
$$;

create function public.touch_app_session(p_active boolean default false) returns jsonb
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare sid uuid;actor public.profiles;session public.app_sessions;stamp timestamptz;begin
 sid=private.app_session_id();
 if auth.uid() is null or sid is null then
 raise exception 'Sessão de autenticação necessária' using errcode='42501',detail='APP_SESSION_REQUIRED';end if;
 if p_active is null then raise exception 'Atividade inválida';end if;
 -- This is the bootstrap RPC, so it must not invoke the session-aware guards.
 select * into actor from public.profiles where id=auth.uid() for share;
 if not found or not actor.is_active then raise exception 'Conta sem acesso ativo' using errcode='42501';end if;
 stamp=clock_timestamp();
 insert into public.app_sessions(session_id,profile_id,created_at,last_seen_at,last_activity_at)
 values(sid,actor.id,stamp,stamp,stamp) on conflict(session_id) do nothing;
 select * into session from public.app_sessions where session_id=sid for update;
 stamp=clock_timestamp();
 if session.profile_id<>actor.id then raise exception 'Sessão não autorizada' using errcode='42501';end if;
 if session.ended_at is not null or session.last_activity_at<=stamp-interval '1 hour' then
 raise exception 'Sessão encerrada por inatividade. Entre novamente.' using errcode='P0001',detail='APP_SESSION_EXPIRED';end if;
 update public.app_sessions set last_seen_at=stamp,
 last_activity_at=case when p_active then stamp else last_activity_at end
 where session_id=sid returning * into session;
 return jsonb_build_object('last_seen_at',session.last_seen_at,'last_activity_at',session.last_activity_at,
 'expires_at',session.last_activity_at+interval '1 hour');
 end
$$;

create function public.end_app_session() returns void
 language plpgsql security definer set search_path=pg_catalog,public as $$
 declare sid uuid;stamp timestamptz;begin
 sid=private.app_session_id();
 if auth.uid() is null or sid is null then
 raise exception 'Sessão de autenticação necessária' using errcode='42501',detail='APP_SESSION_REQUIRED';end if;
 if not exists(select 1 from public.profiles where id=auth.uid())
 then raise exception 'Conta sem acesso ativo' using errcode='42501';end if;
 stamp=clock_timestamp();
 -- A tombstone also prevents a late first heartbeat after logout from starting it.
 insert into public.app_sessions(session_id,profile_id,created_at,last_seen_at,last_activity_at,ended_at)
 values(sid,auth.uid(),stamp,stamp,stamp,stamp)
 on conflict(session_id) do update set ended_at=coalesce(public.app_sessions.ended_at,excluded.ended_at)
 where public.app_sessions.profile_id=auth.uid();
 if not found then raise exception 'Sessão não autorizada' using errcode='42501';end if;
 end
$$;

create function public.team_presence(p_store_id uuid default null)
 returns table(profile_id uuid,is_online boolean)
 language plpgsql stable security definer set search_path=pg_catalog,public as $$
 declare actor public.profiles;begin
 perform private.require_active();
 select * into actor from public.profiles where id=auth.uid();
 if p_store_id is not null and not private.can_store(p_store_id)
 then raise exception 'Quiosque não autorizado' using errcode='42501';end if;
 -- Match profile/team visibility without exposing any session or device metadata.
 return query select p.id,p.is_active and exists(select 1 from public.app_sessions s
 where s.profile_id=p.id and s.ended_at is null
 and s.last_seen_at>statement_timestamp()-interval '90 seconds'
 and s.last_activity_at>statement_timestamp()-interval '1 hour')
 from public.profiles p where p.organization_id=actor.organization_id
 and (p.id=actor.id or actor.role='admin' or (actor.role='manager' and p.role='seller' and p.store_id=actor.store_id))
 and (p_store_id is null or p.store_id=p_store_id or p.id=actor.id or p.role='admin');
 end
$$;

revoke all on function private.app_session_id(),private.app_session_is_active() from public,anon,authenticated;
revoke all on function public.touch_app_session(boolean),public.end_app_session(),public.team_presence(uuid) from public,anon;
grant execute on function public.touch_app_session(boolean),public.end_app_session(),public.team_presence(uuid) to authenticated;

commit;
