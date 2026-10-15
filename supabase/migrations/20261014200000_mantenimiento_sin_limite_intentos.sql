-- Quita el límite de intentos fallidos del acceso web a Mantenimiento
-- (antes: 10 por RUT y 1000 por IP cada 15 minutos). Decisión del usuario.
-- La validación sigue igual: RUT + día y mes de nacimiento del trabajador.
create or replace function public.mantenimiento_validar_trabajador(p_rut text, p_pin text, p_ip text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare canon text; trabajador uuid;
begin
 canon := upper(regexp_replace(p_rut, '[.\s-]', '', 'g'));
 if right(canon,1)='0' then canon := left(canon,-1)||'K'; end if;
 select id into trabajador from public.trabajadores
 where regexp_replace(upper(regexp_replace(rut, '[.\s-]', '', 'g')), '0$', 'K')=canon
 and to_char(fecha_nacimiento,'DDMM')=p_pin and p_pin ~ '^[0-9]{4}$' limit 1;
 return trabajador;
end $$;
revoke all on function public.mantenimiento_validar_trabajador(text,text,text) from public, anon, authenticated;
grant execute on function public.mantenimiento_validar_trabajador(text,text,text) to service_role;

-- Libera los bloqueos que ya estaban activos.
delete from mantenimiento_privado.intentos;
