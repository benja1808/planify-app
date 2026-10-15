create or replace function mantenimiento_privado.planificador() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from auth.users u where u.id=(select auth.uid()) and u.email_confirmed_at is not null
 and (exists(select 1 from mantenimiento_privado.accesos a where a.email=lower(u.email))
 or exists(select 1 from public.planify_sesiones s where s.token_hash=u.raw_app_meta_data->>'maintenance_planner_session'
 and s.rol in ('admin','administrador') and s.expira>now())))
$$;
create or replace function mantenimiento_privado.autorizado() returns boolean
language sql stable security definer set search_path = '' as $$
 select mantenimiento_privado.planificador() or exists(select 1 from auth.users u
 where u.id=(select auth.uid()) and u.email_confirmed_at is not null
 and exists(select 1 from public.trabajadores t where t.id::text=u.raw_app_meta_data->>'maintenance_worker_id'))
$$;
