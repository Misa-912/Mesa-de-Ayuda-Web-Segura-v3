-- =====================================================================
-- NEON - REINICIAR LO QUE YA SE MONTÓ (solo si ya intentó montar la v2)
-- ---------------------------------------------------------------------
-- ¡ATENCIÓN! BORRA las tablas profiles, tickets y audit_logs y el esquema auth
-- de ESTA base de Neon, con todos sus datos. Úselo solo en la base de práctica.
-- Antes de ejecutarlo, si necesita conservar algo, exporte los datos.
--
-- Por qué: database.sql v2 no corre en Neon, así que lo que esté montado
-- probablemente es una adaptación manual (tablas sin auth.users, un auth.users
-- con otras columnas, políticas sin auth.uid(), etc.). Es más seguro empezar
-- limpio que intentar corregir cada adaptación.
--
-- Después ejecute en orden:
--   1) 01_neon_prerequisitos.sql
--   2) database.sql (v3)
--   3) 02_neon_pruebas_rls.sql
-- =====================================================================
drop table if exists public.audit_logs cascade;
drop table if exists public.tickets cascade;
drop table if exists public.profiles cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.set_updated_at() cascade;
drop function if exists public.is_staff() cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.log_ticket_status_change() cascade;
drop function if exists public.enforce_ticket_update() cascade;
drop schema if exists auth cascade;
