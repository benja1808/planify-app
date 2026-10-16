-- La política anterior usaba "name" dentro de un join con mantenimiento_equipos,
-- que también tiene columna "name": se comparaba la carpeta del nombre del equipo
-- en vez de la ruta de la foto, y toda subida fallaba por RLS.
drop policy if exists mantenimiento_fotos_equipo_abierto on storage.objects;
create policy mantenimiento_fotos_equipo_abierto on storage.objects as restrictive for insert to authenticated
 with check (bucket_id <> 'mantenimiento' or exists (
 select 1 from public.mantenimiento_trabajos j join public.mantenimiento_equipos e on e.id=j.equipment_id
 where j.id::text=(storage.foldername(objects.name))[1] and e.is_open));
