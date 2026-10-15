-- Existing equipment starts closed until explicitly opened by the planner.
alter table public.mantenimiento_equipos add column is_open boolean not null default false;

create function mantenimiento_privado.planificador() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from auth.users u
 join mantenimiento_privado.accesos a on a.email=lower(u.email)
 where u.id=(select auth.uid()) and u.email_confirmed_at is not null)
$$;
revoke all on function mantenimiento_privado.planificador() from public, anon;
grant execute on function mantenimiento_privado.planificador() to authenticated;

drop policy mantenimiento_equipo_acceso on public.mantenimiento_equipos;
create policy mantenimiento_equipo_leer on public.mantenimiento_equipos for select to authenticated
 using ((select mantenimiento_privado.autorizado()));
create policy mantenimiento_equipo_crear on public.mantenimiento_equipos for insert to authenticated
 with check ((select mantenimiento_privado.planificador()));
create policy mantenimiento_equipo_editar on public.mantenimiento_equipos for update to authenticated
 using ((select mantenimiento_privado.planificador())) with check ((select mantenimiento_privado.planificador()));

create policy mantenimiento_trabajo_abierto on public.mantenimiento_trabajos as restrictive for insert to authenticated
 with check (exists(select 1 from public.mantenimiento_equipos e where e.id=equipment_id and e.is_open));

-- Also enforce closure on uploads already reserved before the planner closed it.
create policy mantenimiento_fotos_equipo_abierto on storage.objects as restrictive for insert to authenticated
 with check (bucket_id <> 'mantenimiento' or exists (
 select 1 from public.mantenimiento_trabajos j join public.mantenimiento_equipos e on e.id=j.equipment_id
 where j.id::text=(storage.foldername(name))[1] and e.is_open));

-- Prevent moving a reserved job to a closed equipment or publishing after closure.
create function mantenimiento_privado.verificar_equipo_abierto() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 if TG_OP = 'UPDATE' and new.status = 'deleting' and new.equipment_id = old.equipment_id then return new; end if;
 perform 1 from public.mantenimiento_equipos where id=new.equipment_id and is_open for share;
 if not found then raise exception 'El planificador debe abrir el equipo antes de registrar trabajos o fotografías.' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function mantenimiento_privado.verificar_equipo_abierto() from public, anon;
grant execute on function mantenimiento_privado.verificar_equipo_abierto() to authenticated;
create trigger mantenimiento_trabajo_verificar_apertura before insert or update on public.mantenimiento_trabajos
 for each row execute function mantenimiento_privado.verificar_equipo_abierto();
