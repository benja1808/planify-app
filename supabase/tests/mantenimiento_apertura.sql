begin;
insert into auth.users(id,email,email_confirmed_at) values('00000000-0000-4000-8000-000000000011','maintenance-test-planner@example.invalid',now()),('00000000-0000-4000-8000-000000000012','maintenance-test-worker@example.invalid',now());
insert into mantenimiento_privado.accesos(email) values('maintenance-test-planner@example.invalid');
update auth.users set raw_app_meta_data=jsonb_build_object('maintenance_worker_id',(select id::text from public.trabajadores limit 1)) where id='00000000-0000-4000-8000-000000000012';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
insert into public.mantenimiento_equipos(id,name,unit,is_open) values('00000000-0000-4000-8000-000000000013','Prueba apertura rollback','U1',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012',true);
insert into public.mantenimiento_trabajos(equipment_id,category,title,work,reserved_bytes) values('00000000-0000-4000-8000-000000000013','Mantenimiento','Prueba','Prueba',1);
do $$ begin
 update public.mantenimiento_equipos set is_open=false where id='00000000-0000-4000-8000-000000000013';
 if found then raise exception 'Worker changed equipment state'; end if;
 begin
 insert into public.mantenimiento_equipos(name,unit) values('Forbidden worker equipment','U1');
 raise exception 'Worker created equipment';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
update public.mantenimiento_equipos set is_open=false where id='00000000-0000-4000-8000-000000000013';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012',true);
do $$ begin
 begin
 insert into public.mantenimiento_trabajos(equipment_id,category,title,work,reserved_bytes) values('00000000-0000-4000-8000-000000000013','Mantenimiento','Prueba cerrada','Prueba',1);
 raise exception 'Worker uploaded to closed equipment';
 exception when insufficient_privilege then null; end;
 begin
 update public.mantenimiento_trabajos set status='ready' where equipment_id='00000000-0000-4000-8000-000000000013';
 raise exception 'Worker finalized on closed equipment';
 exception when insufficient_privilege then null; end;
 update public.mantenimiento_trabajos set status='deleting' where equipment_id='00000000-0000-4000-8000-000000000013';
 if not found then raise exception 'Cleanup blocked'; end if;
end $$;
select 'Planner opens/closes; worker creates only while open; cleanup allowed' as verified;
rollback;
