-- Only the Edge Function can validate credentials; no birth dates leave this RPC.
create table mantenimiento_privado.intentos (clave text primary key, fallos int not null default 0, desde timestamptz not null default now());
alter table mantenimiento_privado.intentos enable row level security;
revoke all on mantenimiento_privado.intentos from public, anon, authenticated;
create function public.mantenimiento_validar_trabajador(p_rut text, p_pin text, p_ip text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare canon text; trabajador uuid; k text; n int;
begin
 canon := upper(regexp_replace(p_rut, '[.\s-]', '', 'g'));
 if right(canon,1)='0' then canon := left(canon,-1)||'K'; end if;
 foreach k in array array['rut:'||canon, 'ip:'||p_ip] loop
  insert into mantenimiento_privado.intentos(clave) values(k) on conflict do nothing;
  select fallos into n from mantenimiento_privado.intentos where clave=k for update;
  update mantenimiento_privado.intentos set fallos=0, desde=now() where clave=k and desde < now()-interval '15 minutes';
  select fallos into n from mantenimiento_privado.intentos where clave=k;
  if n >= (case when left(k,3)='ip:' then 1000 else 10 end) then return null; end if;
  update mantenimiento_privado.intentos set fallos=fallos+1 where clave=k;
 end loop;
 select id into trabajador from public.trabajadores
 where regexp_replace(upper(regexp_replace(rut, '[.\s-]', '', 'g')), '0$', 'K')=canon
 and to_char(fecha_nacimiento,'DDMM')=p_pin and p_pin ~ '^[0-9]{4}$' limit 1;
 if trabajador is not null then update mantenimiento_privado.intentos set fallos=0 where clave='rut:'||canon; end if;
 return trabajador;
end $$;
revoke all on function public.mantenimiento_validar_trabajador(text,text,text) from public, anon, authenticated;
grant execute on function public.mantenimiento_validar_trabajador(text,text,text) to service_role;

create or replace function mantenimiento_privado.autorizado() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists (
  select 1 from auth.users u where u.id=(select auth.uid()) and u.email_confirmed_at is not null
  and (exists(select 1 from mantenimiento_privado.accesos a where a.email=lower(u.email))
   or exists(select 1 from public.trabajadores t where t.id::text=u.raw_app_meta_data->>'maintenance_worker_id'))
 )
$$;
-- Workers can read the shared history and manage their own uploads only.
drop policy mantenimiento_trabajo_acceso on public.mantenimiento_trabajos;
create policy mantenimiento_trabajo_leer on public.mantenimiento_trabajos for select to authenticated using ((select mantenimiento_privado.autorizado()));
create policy mantenimiento_trabajo_crear on public.mantenimiento_trabajos for insert to authenticated with check ((select mantenimiento_privado.autorizado()) and created_by=auth.uid());
create policy mantenimiento_trabajo_editar on public.mantenimiento_trabajos for update to authenticated using ((select mantenimiento_privado.autorizado()) and created_by=auth.uid()) with check ((select mantenimiento_privado.autorizado()) and created_by=auth.uid());
create policy mantenimiento_trabajo_borrar on public.mantenimiento_trabajos for delete to authenticated using ((select mantenimiento_privado.autorizado()) and created_by=auth.uid());
drop policy mantenimiento_fotos_eliminar on storage.objects;
create policy mantenimiento_fotos_eliminar on storage.objects for delete to authenticated using (bucket_id='mantenimiento' and (select mantenimiento_privado.autorizado()) and exists(select 1 from public.mantenimiento_trabajos j where j.id::text=(storage.foldername(name))[1] and j.created_by=auth.uid()));

drop policy mantenimiento_fotos_subir on storage.objects;
create policy mantenimiento_fotos_subir on storage.objects for insert to authenticated with check(bucket_id='mantenimiento' and (select mantenimiento_privado.autorizado()) and exists(select 1 from public.mantenimiento_trabajos j where j.id::text=(storage.foldername(name))[1] and j.created_by=auth.uid() and j.status='uploading' and exists(select 1 from jsonb_array_elements(j.photos) p where p->>'path'=name)));
