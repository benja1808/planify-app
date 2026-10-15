-- Workers need read access to equipment, not permission to update its state.
create or replace function mantenimiento_privado.verificar_equipo_abierto() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 if TG_OP = 'UPDATE' and new.status = 'deleting' and new.equipment_id = old.equipment_id then return new; end if;
 perform 1 from public.mantenimiento_equipos where id=new.equipment_id and is_open;
 if not found then raise exception 'El planificador debe abrir el equipo antes de registrar trabajos o fotografías.' using errcode='42501'; end if;
 return new;
end $$;
