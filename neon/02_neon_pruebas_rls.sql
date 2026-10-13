-- =====================================================================
-- NEON - PRUEBAS DE RLS, CHECK Y AUDITORÍA (ejecutar después de database.sql)
-- Ejecute el archivo COMPLETO. Cada prueba imprime PASA o FALLA en Messages / Output.
-- Al final se hace ROLLBACK: no deja datos de prueba en la base.
-- =====================================================================
begin;

-- Usuarios simulados (en Supabase se crean al registrarse desde la app).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'usuario.a@prueba.test', '{"full_name":"Usuario A"}'),
  ('00000000-0000-0000-0000-00000000000b', 'usuario.b@prueba.test', '{"full_name":"Usuario B"}'),
  ('00000000-0000-0000-0000-00000000000c', 'tecnico@prueba.test',   '{"full_name":"Técnico Uno"}'),
  ('00000000-0000-0000-0000-00000000000d', 'ab@prueba.test',        '{}');
-- El rol técnico se asigna de forma controlada (igual que el Paso 9 del manual).
update public.profiles set role = 'tecnico' where id = '00000000-0000-0000-0000-00000000000c';

do $$
declare
  v_count int;
  v_id bigint;
  v_tech uuid;
  v_ok boolean;
begin
  -- 1. Trigger de perfiles
  select count(*) into v_count from public.profiles
  where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d');
  raise notice '% Trigger crea perfiles (incluye correo corto ab@...)', case when v_count = 2 then 'PASA ' else 'FALLA' end;

  -- 2. Usuario A crea ticket
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  set local role authenticated;
  insert into public.tickets (user_id, title, description, category, priority)
  values (auth.uid(), 'No puedo ingresar al sistema', 'Aparece un error al iniciar sesión.', 'Acceso', 'Media')
  returning id into v_id;
  raise notice 'PASA  Usuario A crea ticket #%', v_id;

  -- 3. Restricciones CHECK
  begin
    insert into public.tickets (user_id, title, description, category)
    values (auth.uid(), 'Título válido', 'Descripción válida de prueba', 'Inventada');
    raise notice 'FALLA Categoría inválida fue aceptada';
  exception when check_violation then
    raise notice 'PASA  Categoría inválida rechazada por CHECK';
  end;
  begin
    insert into public.tickets (user_id, title, description, category)
    values (auth.uid(), 'abc', 'Descripción válida de prueba', 'Otro');
    raise notice 'FALLA Título corto fue aceptado';
  exception when check_violation then
    raise notice 'PASA  Título corto rechazado por CHECK';
  end;

  -- 4. Usuario normal no puede actualizar
  update public.tickets set status = 'Cerrado' where id = v_id;
  get diagnostics v_count = row_count;
  raise notice '% Usuario normal NO cambia estado (filas afectadas: %)', case when v_count = 0 then 'PASA ' else 'FALLA' end, v_count;
  reset role;

  -- 5. Usuario B no ve el ticket de A
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  set local role authenticated;
  select count(*) into v_count from public.tickets where id = v_id;
  raise notice '% Usuario B NO ve ticket de A', case when v_count = 0 then 'PASA ' else 'FALLA' end;
  begin
    insert into public.tickets (user_id, title, description, category)
    values ('00000000-0000-0000-0000-00000000000a', 'Suplantación', 'Intento de crear a nombre de A', 'Otro');
    raise notice 'FALLA Usuario B creó ticket a nombre de A';
  exception when insufficient_privilege then
    raise notice 'PASA  Usuario B NO crea tickets a nombre de A';
  end;
  reset role;

  -- 6. Técnico gestiona y se audita
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  set local role authenticated;
  update public.tickets set status = 'En proceso' where id = v_id returning technician_id into v_tech;
  raise notice '% Técnico pasa a En proceso y queda asignado', case when v_tech = auth.uid() then 'PASA ' else 'FALLA' end;
  begin
    update public.tickets set status = 'Abierto' where id = v_id;
    raise notice 'FALLA Transición no permitida fue aceptada';
  exception when raise_exception then
    raise notice 'PASA  Transición En proceso -> Abierto bloqueada';
  end;
  begin
    update public.tickets set title = 'Cambiado por técnico' where id = v_id;
    raise notice 'FALLA Técnico modificó el título';
  exception when insufficient_privilege then
    raise notice 'PASA  Técnico NO modifica el título';
  end;
  reset role;

  select exists (select 1 from public.audit_logs where ticket_id = v_id and action = 'STATUS_CHANGE'
                 and old_status = 'Abierto' and new_status = 'En proceso'
                 and actor_id = '00000000-0000-0000-0000-00000000000c') into v_ok;
  raise notice '% audit_logs registra el cambio de estado', case when v_ok then 'PASA ' else 'FALLA' end;
end $$;

rollback;
