-- 0011_mailchimp: a second campaign provider, and which one the shop uses
-- (2026-11-07).
--
-- Campaigns can go through Resend Broadcasts or Mailchimp. Receipts and other
-- transactional mail stay with Resend either way: Mailchimp does not send
-- transactional mail (that is Mandrill, a separate product and key), so the
-- two settings are genuinely different things and are kept apart.
--
-- Three columns were written as `check (... in ('resend'))` when Resend was
-- the only option. Each is widened here rather than edited in place in the
-- migration that created it. Needs 0010_email_provider_keys.

-- email_campaigns.provider ------------------------------------------------------

alter table public.email_campaigns drop constraint if exists email_campaigns_provider_check;
alter table public.email_campaigns
  add constraint email_campaigns_provider_check
  check (provider in ('resend', 'mailchimp'));

-- email_audiences.provider --------------------------------------------------------

alter table public.email_audiences drop constraint if exists email_audiences_provider_check;
alter table public.email_audiences
  add constraint email_audiences_provider_check
  check (provider in ('resend', 'mailchimp'));

-- A shop that switches provider keeps its rows per locale, but the audience
-- id means something different at each provider (a Resend audience id, or
-- Mailchimp's "<list id>:<tag>"), so the pair has to be unique together
-- rather than the locale alone deciding.
-- No cascade: nothing references this table, and if something ever does, the
-- migration should fail loudly rather than drop the reference.
alter table public.email_audiences drop constraint if exists email_audiences_pkey;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'email_audiences_locale_provider_key'
  ) then
    alter table public.email_audiences
      add constraint email_audiences_locale_provider_key primary key (locale, provider);
  end if;
end $$;

-- email_provider_keys.provider ------------------------------------------------

alter table public.email_provider_keys drop constraint if exists email_provider_keys_provider_check;
alter table public.email_provider_keys
  add constraint email_provider_keys_provider_check
  check (provider in ('resend', 'mailchimp'));

-- Which provider sends campaigns. A shop may hold a key for both — switching
-- should not mean retyping one — so exactly one row is the active one.
alter table public.email_provider_keys
  add column if not exists is_active boolean not null default false;

-- At most one. The expression index is on a constant, so the partial index
-- allows a single row where is_active is true.
create unique index if not exists idx_email_provider_keys_one_active
  on public.email_provider_keys ((true)) where is_active;

-- The first key stored becomes the active one; later ones do not steal it.
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
  v_had_any boolean;
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can set the email provider key'
      using errcode = '42501';
  end if;

  if p_provider is null or p_provider not in ('resend', 'mailchimp') then
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

  select exists (select 1 from public.email_provider_keys where is_active) into v_had_any;

  v_name := 'email_provider_key_' || p_provider;

  execute 'select id from vault.secrets where name = $1'
    into v_existing using v_name;

  if v_existing is null then
    execute 'select vault.create_secret($1, $2, $3)'
      using v_key, v_name, 'Email provider key for ' || p_provider;
  else
    execute 'select vault.update_secret($1, $2)'
      using v_existing, v_key;
  end if;

  insert into public.email_provider_keys
    (provider, secret_name, last_four, set_at, set_by, verified_at, is_active)
  values
    (p_provider, v_name, right(v_key, 4), now(), auth.uid(), now(), not v_had_any)
  on conflict (provider) do update
     set secret_name = excluded.secret_name,
         last_four = excluded.last_four,
         set_at = now(),
         set_by = excluded.set_by,
         verified_at = now();
end;
$$;

-- Switch which provider sends campaigns. Only one whose key is stored can be
-- chosen: picking a provider the shop has no key for would simply stop it
-- sending, with nothing on screen to explain why.
create or replace function public.set_active_email_provider(p_provider text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can choose the email provider'
      using errcode = '42501';
  end if;

  if p_provider is null or p_provider not in ('resend', 'mailchimp') then
    raise exception 'Unknown email provider %', p_provider
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.email_provider_keys where provider = p_provider) then
    raise exception 'No key is stored for %', p_provider
      using errcode = '22023';
  end if;

  -- Cleared first: the unique index allows only one true at a time.
  update public.email_provider_keys set is_active = false where is_active;
  update public.email_provider_keys set is_active = true where provider = p_provider;
end;
$$;

-- Clearing the active key hands the flag to whatever other key remains, so a
-- shop with two keys does not silently end up with none selected.
create or replace function public.clear_email_provider_key(p_provider text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_was_active boolean;
  v_next text;
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can clear the email provider key'
      using errcode = '42501';
  end if;

  select secret_name, is_active into v_name, v_was_active
    from public.email_provider_keys
   where provider = p_provider;

  if v_name is null then
    return;
  end if;

  if public.vault_is_available() then
    execute 'delete from vault.secrets where name = $1' using v_name;
  end if;

  delete from public.email_provider_keys where provider = p_provider;

  if v_was_active then
    select provider into v_next from public.email_provider_keys order by set_at limit 1;
    if v_next is not null then
      update public.email_provider_keys set is_active = true where provider = v_next;
    end if;
  end if;
end;
$$;

revoke all on function public.set_email_provider_key(text, text) from public, anon;
grant execute on function public.set_email_provider_key(text, text) to authenticated;
revoke all on function public.clear_email_provider_key(text) from public, anon;
grant execute on function public.clear_email_provider_key(text) to authenticated;
revoke all on function public.set_active_email_provider(text) from public, anon;
grant execute on function public.set_active_email_provider(text) to authenticated;
