-- Limpieza puntual: la OT 2002175149 fue cargada inicialmente con fecha
-- 2026-06-19 y luego recreada correctamente con fecha 2026-06-18.
-- El bloque exige ambos conjuntos completos antes de borrar las copias antiguas.
do $$
declare
    old_count integer;
    correct_count integer;
begin
    select count(*)
      into old_count
      from public.mediciones
     where equipo_id = '50ce4654-9388-4fa2-bc12-e178c7529b9a'
       and fecha >= '2026-06-19 00:00:00+00'
       and fecha <  '2026-06-20 00:00:00+00'
       and notas = '{"t":["Ana Baez","Diego Campillay"],"o":""}'
       and punto_medicion like 'Escobilla %';

    select count(*)
      into correct_count
      from public.mediciones
     where equipo_id = '50ce4654-9388-4fa2-bc12-e178c7529b9a'
       and fecha >= '2026-06-18 00:00:00+00'
       and fecha <  '2026-06-19 00:00:00+00'
       and notas = '{"t":["Ana Baez","Diego Campillay"],"o":""}'
       and punto_medicion like 'Escobilla %';

    if old_count <> 56 or correct_count <> 56 then
        raise exception
            'Se esperaban 56 lecturas antiguas y 56 correctas; encontradas antiguas %, correctas %',
            old_count, correct_count;
    end if;

    delete from public.mediciones
     where equipo_id = '50ce4654-9388-4fa2-bc12-e178c7529b9a'
       and fecha >= '2026-06-19 00:00:00+00'
       and fecha <  '2026-06-20 00:00:00+00'
       and notas = '{"t":["Ana Baez","Diego Campillay"],"o":""}'
       and punto_medicion like 'Escobilla %';
end
$$;
