create schema if not exists mantenimiento_privado;
revoke all on schema mantenimiento_privado from public, anon;
grant usage on schema mantenimiento_privado to authenticated;
create table mantenimiento_privado.accesos (
 email text primary key check(email = lower(email)),
 created_at timestamptz not null default now()
);
revoke all on mantenimiento_privado.accesos from public, anon, authenticated;

create function mantenimiento_privado.autorizado() returns boolean
language sql stable security definer set search_path = ''
as $$
 select exists (
 select 1 from auth.users u join mantenimiento_privado.accesos a on a.email=lower(u.email)
 where u.id=(select auth.uid()) and u.email_confirmed_at is not null
 )
$$;
revoke all on function mantenimiento_privado.autorizado() from public, anon;
grant execute on function mantenimiento_privado.autorizado() to authenticated;

create table public.mantenimiento_equipos (
 id uuid primary key default gen_random_uuid(),
 source_id uuid references public.equipos(id) on delete set null,
 name text not null check(length(trim(name)) between 1 and 160),
 unit text not null check(unit in ('U1','U2','U3','U4','U5')),
 kks text not null default '',
 created_at timestamptz not null default now()
);
create unique index mantenimiento_equipo_nombre_unidad on public.mantenimiento_equipos(unit,lower(trim(name)));
create unique index mantenimiento_equipo_origen on public.mantenimiento_equipos(source_id) where source_id is not null;
create table public.mantenimiento_trabajos (
 id uuid primary key default gen_random_uuid(),
 equipment_id uuid not null references public.mantenimiento_equipos(id) on delete restrict,
 category text not null check(category in ('Mantenimiento','END','Ultrasonido')),
 title text not null check(length(trim(title)) between 1 and 180),
 work text not null check(length(trim(work)) between 1 and 10000),
 date timestamptz not null default now(),
 photos jsonb not null default '[]' check(jsonb_typeof(photos)='array'),
 status text not null default 'uploading' check(status in ('uploading','ready','deleting')),
 created_by uuid not null default auth.uid() references auth.users(id),
 reserved_bytes bigint not null check(reserved_bytes between 1 and 1000000000)
);
create index mantenimiento_trabajos_equipo on public.mantenimiento_trabajos(equipment_id);
alter table public.mantenimiento_equipos enable row level security;
alter table public.mantenimiento_trabajos enable row level security;
revoke all on public.mantenimiento_equipos, public.mantenimiento_trabajos from anon;
grant select,insert,update,delete on public.mantenimiento_equipos, public.mantenimiento_trabajos to authenticated;
create policy mantenimiento_equipo_acceso on public.mantenimiento_equipos for all to authenticated
 using ((select mantenimiento_privado.autorizado())) with check ((select mantenimiento_privado.autorizado()));
create policy mantenimiento_trabajo_acceso on public.mantenimiento_trabajos for all to authenticated
 using ((select mantenimiento_privado.autorizado())) with check ((select mantenimiento_privado.autorizado()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('mantenimiento','mantenimiento',false,20971520,array['image/jpeg','image/png','image/webp']);
create policy mantenimiento_fotos_leer on storage.objects for select to authenticated
using(bucket_id='mantenimiento' and (select mantenimiento_privado.autorizado()));
create policy mantenimiento_fotos_subir on storage.objects for insert to authenticated
with check(bucket_id='mantenimiento' and (select mantenimiento_privado.autorizado()) and exists (
 select 1 from public.mantenimiento_trabajos j
 where j.id::text=(storage.foldername(name))[1] and j.status='uploading'
 and exists(select 1 from jsonb_array_elements(j.photos) p where p->>'path'=name)
));
create policy mantenimiento_fotos_eliminar on storage.objects for delete to authenticated
using(bucket_id='mantenimiento' and (select mantenimiento_privado.autorizado()));

create function mantenimiento_privado.consumo() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare used bigint; pending bigint;
begin
 if auth.uid() is null or not mantenimiento_privado.autorizado() then
 raise exception 'Acceso no autorizado' using errcode='42501'; end if;
 select coalesce(sum((metadata->>'size')::bigint),0) into used from storage.objects;
 select coalesce(sum(j.reserved_bytes),0) into pending from public.mantenimiento_trabajos j where j.status='uploading';
 return jsonb_build_object('used',used,'reserved',pending,'limit',1000000000);
end $$;
revoke all on function mantenimiento_privado.consumo() from public, anon;
grant execute on function mantenimiento_privado.consumo() to authenticated;
create function public.mantenimiento_consumo() returns jsonb language sql stable security invoker set search_path=''
as $$select mantenimiento_privado.consumo()$$;
revoke all on function public.mantenimiento_consumo() from public, anon;
grant execute on function public.mantenimiento_consumo() to authenticated;
create function public.mantenimiento_reservar(payload jsonb) returns public.mantenimiento_trabajos
language plpgsql security invoker set search_path=''
as $$
declare usage jsonb; amount bigint; result public.mantenimiento_trabajos;
begin
 if not mantenimiento_privado.autorizado() then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(4173001);
 usage := mantenimiento_privado.consumo();
 select coalesce(sum((p->>'size')::bigint),0) into amount from jsonb_array_elements(payload->'photos') p;
 if amount < 1 or (usage->>'used')::bigint+(usage->>'reserved')::bigint+amount>1000000000 then
 raise exception 'La carga supera el espacio disponible de 1 GB'; end if;
 if jsonb_array_length(payload->'photos') not between 1 and 100 then raise exception 'Selecciona entre 1 y 100 fotografías'; end if;
 if exists(select 1 from jsonb_array_elements(payload->'photos') p where (p->>'size')::bigint not between 1 and 20971520 or p->>'mime' not in ('image/jpeg','image/png','image/webp') or p->>'path' not like (payload->>'id')||'/%') then
 raise exception 'Fotografías inválidas (máximo 20 MB por foto)'; end if;
 insert into public.mantenimiento_trabajos(id,equipment_id,category,title,work,photos,reserved_bytes)
 values((payload->>'id')::uuid,(payload->>'equipment_id')::uuid,payload->>'category',payload->>'title',payload->>'work',payload->'photos',amount) returning * into result;
 return result;
end $$;
revoke all on function public.mantenimiento_reservar(jsonb) from public, anon;
grant execute on function public.mantenimiento_reservar(jsonb) to authenticated;
