-- =====================================================================
-- NEON - PRERREQUISITOS PARA EJECUTAR database.sql
-- ---------------------------------------------------------------------
-- database.sql fue escrito para Supabase y usa objetos que SOLO existen en
-- Supabase: el esquema auth (tabla auth.users), la función auth.uid() y los
-- roles anon / authenticated. En Neon esos objetos no existen y database.sql
-- falla con errores como:
--   ERROR: schema "auth" does not exist
--   ERROR: role "authenticated" does not exist
--
-- Este script crea equivalentes MÍNIMOS para practicar en Neon:
--   tablas, CHECK, triggers, auditoría y RLS.
--
-- LIMITACIÓN: la aplicación web (index.html + main.ts) usa Supabase Auth y la
-- Data API de Supabase. NO se conecta a Neon. En Neon la base se prueba con
-- SQL (ver 02_neon_pruebas_rls.sql).
--
-- Orden en Neon > SQL Editor:
--   0) 00_neon_reiniciar.sql       (SOLO si ya había montado algo antes; borra datos)
--   1) 01_neon_prerequisitos.sql   (este archivo)
--   2) database.sql                (el mismo de Supabase, sin cambios; v3 detecta Neon)
--   3) 02_neon_pruebas_rls.sql
-- =====================================================================

-- Roles que usa Supabase. NOLOGIN: nadie se conecta con ellos, solo se usan con SET ROLE.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- Permite al usuario actual (neondb_owner) "actuar como" authenticated en las pruebas.
grant anon, authenticated to current_user;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

-- Versión mínima de auth.users (en Supabase la administra Supabase Auth).
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- auth.uid(): en Supabase sale del token JWT de la sesión.
-- Aquí se simula con una variable de sesión:  select set_config('request.jwt.claim.sub', '<uuid>', false);
-- Si Neon ya tiene auth.uid() (por ejemplo con Neon Auth/Data API) no se reemplaza.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $f$
      create function auth.uid() returns uuid language sql stable as
      $b$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $b$
    $f$;
  end if;
end $$;

grant execute on function auth.uid() to anon, authenticated;
