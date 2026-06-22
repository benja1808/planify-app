-- Limpieza puntual: la OT 2002175150 fue cargada inicialmente con fecha
-- 2026-06-19 y luego recreada correctamente con fecha 2026-06-18.
do $$
declare
    old_count integer;
    correct_count integer;
begin
    select count(*)
      into old_count
      from public.mediciones
     where equipo_id = 'b7d3d070-5765-44e2-8c8e-97f65b02e218'
       and fecha >= '2026-06-19 00:00:00+00'
       and fecha <  '2026-06-20 00:00:00+00'
       and notas = '{"t":["Ana Baez","Diego Campillay"],"o":""}'
       and punto_medicion like 'Escobilla %';

    select count(*)
      into correct_count
      from public.mediciones
     where equipo_id = 'b7d3d070-5765-44e2-8c8e-97f65b02e218'
       and fecha >= '2026-06-18 00:00:00+00'
       and fecha <  '2026-06-19 00:00:00+00'
       and notas = '{"t":["Ana Baez","Diego Campillay"],"o":""}'
       and punto_medicion like 'Escobilla %';

    if old_count <> 42 or correct_count <> 42 then
        raise exception
            'Se esperaban 42 lecturas antiguas y 42 correctas; encontradas antiguas %, correctas %',
            old_count, correct_count;
    end if;

    delete from public.mediciones
     where equipo_id = 'b7d3d070-5765-44e2-8c8e-97f65b02e218'
       and fecha >= '2026-06-19 00:00:00+00'
       and fecha <  '2026-06-20 00:00:00+00'
       and notas = '{"t":["Ana Baez","Diego Campillay"],"o":""}'
       and punto_medicion like 'Escobilla %';
end
$$;
