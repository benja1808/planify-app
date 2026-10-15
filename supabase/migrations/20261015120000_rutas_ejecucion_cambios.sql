-- Captura simultánea de una misma OT de ruta por varias personas.
--
-- Antes cada dispositivo enviaba los mapas completos (mediciones, estados,
-- observaciones) y el último en guardar borraba lo que habían subido los demás.
-- Ahora cada dispositivo envía solo las claves que cambió ("eq.comp") y esta
-- función las aplica sobre el valor actual dentro de un único UPDATE: las
-- escrituras concurrentes sobre la misma fila se ordenan y ninguna se pierde.
--
--   p_set: { "mediciones": { "3.1": {...} }, "componentes_estado": { "3.1": "listo" }, ... }
--   p_del: { "observaciones": ["3.1"], ... }
--
-- Devuelve la fila completa ya combinada (incluye lo de los otros dispositivos),
-- o nada si la OT ya no está activa.

create or replace function public.rutas_ejecucion_aplicar(p_id text, p_set jsonb, p_del jsonb)
returns setof public.rutas_ejecuciones
language sql
security invoker
set search_path = public
as $$
    update public.rutas_ejecuciones set
        componentes_estado = (coalesce(componentes_estado, '{}'::jsonb) || coalesce(p_set -> 'componentes_estado', '{}'::jsonb))
            - coalesce(array(select jsonb_array_elements_text(p_del -> 'componentes_estado')), '{}'::text[]),
        componentes_at = (coalesce(componentes_at, '{}'::jsonb) || coalesce(p_set -> 'componentes_at', '{}'::jsonb))
            - coalesce(array(select jsonb_array_elements_text(p_del -> 'componentes_at')), '{}'::text[]),
        observaciones = (coalesce(observaciones, '{}'::jsonb) || coalesce(p_set -> 'observaciones', '{}'::jsonb))
            - coalesce(array(select jsonb_array_elements_text(p_del -> 'observaciones')), '{}'::text[]),
        mediciones = (coalesce(mediciones, '{}'::jsonb) || coalesce(p_set -> 'mediciones', '{}'::jsonb))
            - coalesce(array(select jsonb_array_elements_text(p_del -> 'mediciones')), '{}'::text[])
    where id::text = p_id
      and estado = 'activa'
    returning *;
$$;

grant execute on function public.rutas_ejecucion_aplicar(text, jsonb, jsonb) to anon, authenticated;

-- Que cada técnico vea en vivo el avance que captura su compañero en la misma OT.
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rutas_ejecuciones') then
        alter publication supabase_realtime add table public.rutas_ejecuciones;
    end if;
end $$;
