-- Acceso con PIN validado en el servidor (Planificador, Administrador, ITO).
--
-- Antes el sitio publicado no podía validar el PIN de Planificador/Administrador
-- (solo el servidor local lo hacía) y la sesión guardada era solo el nombre del
-- rol en el navegador. Ahora:
--   * Los PIN se guardan como hash bcrypt en una tabla que el navegador no puede leer.
--   * planify_login valida el PIN, limita intentos fallidos y entrega un token de sesión.
--   * planify_validar_sesion comprueba ese token al recargar la página.
--
-- Después de ejecutar este archivo, define cada PIN en el SQL Editor (no se
-- guarda en el repositorio):
--   select planify_establecer_pin('admin', '<PIN de 4 dígitos>');
--   select planify_establecer_pin('administrador', '<PIN de 4 dígitos>');
--   select planify_establecer_pin('ito', '<PIN de 4 dígitos>');

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.planify_pines (
    rol text primary key check (rol in ('admin', 'administrador', 'ito')),
    pin_hash text not null,
    actualizado timestamptz not null default now()
);

create table if not exists public.planify_sesiones (
    token_hash text primary key,
    rol text not null,
    creada timestamptz not null default now(),
    expira timestamptz not null
);

create table if not exists public.planify_intentos_pin (
    origen text primary key,
    fallos integer not null default 0,
    desde timestamptz not null default now()
);

-- Sin políticas: con RLS activo, anon/authenticated no pueden leer ni escribir.
-- Solo las funciones SECURITY DEFINER de abajo acceden a estas tablas.
alter table public.planify_pines enable row level security;
alter table public.planify_sesiones enable row level security;
alter table public.planify_intentos_pin enable row level security;
revoke all on public.planify_pines, public.planify_sesiones, public.planify_intentos_pin from anon, authenticated;

create or replace function public.planify_establecer_pin(p_rol text, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if p_rol not in ('admin', 'administrador', 'ito') then
        raise exception 'Rol no válido: %', p_rol;
    end if;
    if p_pin !~ '^\d{4}$' then
        raise exception 'El PIN debe tener exactamente 4 dígitos.';
    end if;
    insert into planify_pines (rol, pin_hash, actualizado)
    values (p_rol, crypt(p_pin, gen_salt('bf', 10)), now())
    on conflict (rol) do update set pin_hash = excluded.pin_hash, actualizado = now();
    -- Cambiar el PIN cierra las sesiones abiertas de ese rol.
    delete from planify_sesiones where rol = p_rol;
end;
$$;

create or replace function public.planify_login(p_rol text, p_pin text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_headers json;
    v_origen text;
    v_fallos integer;
    v_desde timestamptz;
    v_hash text;
    v_token text;
begin
    begin
        v_headers := nullif(current_setting('request.headers', true), '')::json;
    exception when others then
        v_headers := null;
    end;
    v_origen := coalesce(nullif(trim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''), 'desconocido');

    select fallos, desde into v_fallos, v_desde from planify_intentos_pin where origen = v_origen;
    if v_desde is not null and v_desde < now() - interval '15 minutes' then
        delete from planify_intentos_pin where origen = v_origen;
        v_fallos := 0;
    end if;
    if coalesce(v_fallos, 0) >= 5 then
        return json_build_object('ok', false, 'error', 'Demasiados intentos fallidos. Espera 15 minutos.');
    end if;

    select pin_hash into v_hash from planify_pines where rol = p_rol;
    if v_hash is null or coalesce(p_pin, '') !~ '^\d{4}$' or crypt(p_pin, v_hash) <> v_hash then
        insert into planify_intentos_pin (origen, fallos, desde)
        values (v_origen, 1, now())
        on conflict (origen) do update set fallos = planify_intentos_pin.fallos + 1;
        return json_build_object('ok', false, 'error', 'PIN incorrecto.');
    end if;

    delete from planify_intentos_pin where origen = v_origen;
    delete from planify_sesiones where expira < now();
    v_token := encode(gen_random_bytes(32), 'hex');
    insert into planify_sesiones (token_hash, rol, expira)
    values (encode(digest(v_token, 'sha256'), 'hex'), p_rol, now() + interval '30 days');
    return json_build_object('ok', true, 'rol', p_rol, 'token', v_token);
end;
$$;

create or replace function public.planify_validar_sesion(p_token text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
    select rol from planify_sesiones
    where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and expira > now();
$$;

create or replace function public.planify_cerrar_sesion(p_token text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
    delete from planify_sesiones
    where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

revoke all on function public.planify_establecer_pin(text, text) from public, anon, authenticated;
revoke all on function public.planify_login(text, text) from public;
revoke all on function public.planify_validar_sesion(text) from public;
revoke all on function public.planify_cerrar_sesion(text) from public;
grant execute on function public.planify_login(text, text) to anon, authenticated;
grant execute on function public.planify_validar_sesion(text) to anon, authenticated;
grant execute on function public.planify_cerrar_sesion(text) to anon, authenticated;
