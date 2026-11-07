-- 0010_email_provider_keys: the campaign provider's key, set from the admin
-- and kept in Supabase Vault (2026-11-07).
--
-- The key is write-only by design. The owner types it in, the server tests it
-- against the provider, and only a test that passed stores it — encrypted, in
-- Vault, reachable with the service-role key alone. Nothing ever reads it back
-- to a browser: the admin is told that a key is set, when, and its last four
-- characters, and nothing more.
--
-- public.email_provider_keys is metadata only. The secret itself never lands
-- in a table in public, and so never in a database dump taken through the
-- Data API. Needs 0001_init.

-- Vault ships with Supabase but not with a bare Postgres, and the schema has
-- to apply to both (test/check-schema.sh runs against postgres:16 with a
-- stand-in). So the functions below reach Vault through dynamic SQL and this
-- check, instead of the migration failing at install time.
create or replace function public.vault_is_available()
returns boolean
language sql
stable
as $$
  select to_regprocedure('vault.create_secret(text,text,text)') is not null
     and to_regclass('vault.decrypted_secrets') is not null;
$$;

create table if not exists public.email_provider_keys (
  provider text primary key check (provider in ('resend')),
  -- The name the secret goes under in Vault. Never the secret.
  secret_name text not null,
  -- At most the last four characters, so the owner can tell which key is in
  -- place without the shop being able to show the key itself.
  last_four text check (last_four is null or char_length(last_four) <= 4),
  set_at timestamptz not null default now(),
  set_by uuid references public.profiles(id) on delete set null,
  -- When a test against the provider last passed. A key is only ever stored
  -- after one, so this starts equal to set_at.
  verified_at timestamptz
);

alter table public.email_provider_keys enable row level security;

-- The owner may look, and that is all: every write goes through the functions
-- below, which are the only things allowed to touch Vault.
drop policy if exists "Email provider keys read for owner" on public.email_provider_keys;
create policy "Email provider keys read for owner"
  on public.email_provider_keys
  for select
  using (public.is_shop_owner());

revoke all on public.email_provider_keys from anon, authenticated;
grant select on public.email_provider_keys to authenticated;

-- Store a key. Called by the admin only after the key has been tested
-- against the provider, so reaching here means it worked.
create or replace function public.set_email_provider_key(
  p_provider text,
  p_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_name text;
  v_existing uuid;
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can set the email provider key'
      using errcode = '42501';
  end if;

  if p_provider is null or p_provider not in ('resend') then
    raise exception 'Unknown email provider %', p_provider
      using errcode = '22023';
  end if;

  v_key := trim(coalesce(p_key, ''));
  if char_length(v_key) < 8 then
    raise exception 'That does not look like a provider key'
      using errcode = '22023';
  end if;

  if not public.vault_is_available() then
    raise exception 'Supabase Vault is not enabled on this project'
      using errcode = '0A000';
  end if;

  v_name := 'email_provider_key_' || p_provider;

  execute 'select id from vault.secrets where name = $1'
    into v_existing using v_name;

  if v_existing is null then
    execute 'select vault.create_secret($1, $2, $3)'
      using v_key, v_name, 'Email provider key for ' || p_provider;
  else
    -- Replacing a key, not keeping both: there is one key per provider.
    execute 'select vault.update_secret($1, $2)'
      using v_existing, v_key;
  end if;

  insert into public.email_provider_keys
    (provider, secret_name, last_four, set_at, set_by, verified_at)
  values
    (p_provider, v_name, right(v_key, 4), now(), auth.uid(), now())
  on conflict (provider) do update
     set secret_name = excluded.secret_name,
         last_four = excluded.last_four,
         set_at = now(),
         set_by = excluded.set_by,
         verified_at = now();
end;
$$;

-- Read the key back. The server's job alone: execute is taken away from
-- everyone below service_role, so the signed-in owner cannot call this from
-- the browser and read out what they typed. That is what makes it write-only.
create or replace function public.get_email_provider_key(p_provider text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_secret text;
begin
  if not public.vault_is_available() then
    return null;
  end if;

  select secret_name into v_name
    from public.email_provider_keys
   where provider = p_provider;

  if v_name is null then
    return null;
  end if;

  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
    into v_secret using v_name;

  return nullif(trim(coalesce(v_secret, '')), '');
end;
$$;

-- Forget a key: the secret goes from Vault and the metadata row with it, so
-- the admin falls back to the environment (or to not configured).
create or replace function public.clear_email_provider_key(p_provider text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can clear the email provider key'
      using errcode = '42501';
  end if;

  select secret_name into v_name
    from public.email_provider_keys
   where provider = p_provider;

  if v_name is null then
    return;
  end if;

  if public.vault_is_available() then
    execute 'delete from vault.secrets where name = $1' using v_name;
  end if;

  delete from public.email_provider_keys where provider = p_provider;
end;
$$;

revoke all on function public.set_email_provider_key(text, text) from public, anon;
grant execute on function public.set_email_provider_key(text, text) to authenticated;
revoke all on function public.clear_email_provider_key(text) from public, anon;
grant execute on function public.clear_email_provider_key(text) to authenticated;
-- Service role only. Not granted to authenticated on purpose.
revoke all on function public.get_email_provider_key(text) from public, anon, authenticated;
