-- Just enough of Supabase for the shop schema to apply: auth.users, auth.uid()
-- read from a request setting, the API roles, storage tables.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
-- Like Supabase's: the legacy per-claim setting, or the claims JSON PostgREST sets.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public, auth to anon, authenticated, service_role;
-- Supabase's own defaults: every API role may reach every new table,
-- function and sequence in public, and row-level security decides. The
-- shop's schema revokes what it must, so test it against the same start.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
-- Supabase Vault, enough of it for 0010_email_provider_keys to run.
--
-- WARNING: this stand-in stores secrets in PLAINTEXT. It exists so the tests
-- can exercise who may set and read a provider key, not to check the
-- encryption, which is Vault's own and is not reimplemented here. Nothing
-- outside test/ should ever create this schema.
create schema if not exists vault;
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text default '',
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at, updated_at
    from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into vault.secrets (name, description, secret)
  values (new_name, coalesce(new_description, ''), new_secret)
  returning id into v_id;
  return v_id;
end $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null)
returns void language plpgsql as $$
begin
  update vault.secrets
     set secret = coalesce(new_secret, secret),
         name = coalesce(new_name, name),
         description = coalesce(new_description, description),
         updated_at = now()
   where id = secret_id;
end $$;
-- On Supabase the API roles cannot reach vault at all; only the service role
-- and SECURITY DEFINER functions do. Mirror that: no grant to anon or
-- authenticated, so a test that tries to read the secret directly fails the
-- same way it would in production.
revoke all on schema vault from anon, authenticated;
revoke all on all tables in schema vault from anon, authenticated;
revoke all on all functions in schema vault from anon, authenticated;

create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
-- As on Supabase: the API roles reach the table, row-level security decides.
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
