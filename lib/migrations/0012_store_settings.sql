-- 0012_store_settings: shop-wide settings the owner edits in the admin
-- (2026-11-19).
--
-- One row per setting, a JSON document each, so a new setting is a new key
-- and not a new migration. The first key is `email_brand`: the logo, colours,
-- font and footer address that the receipt, shipping and refund emails are
-- dressed in, and that new campaign templates start from. The roadmap's
-- store settings (currency, shipping zones, product fields, theme) are meant
-- to land here as further keys.
--
-- Settings are not secrets: anything confidential goes to Vault
-- (0010_email_provider_keys), never into this table. So everyone may read a
-- setting — a storefront page will need the shop's currency or theme — and
-- only the owner may write one. The application validates each document's
-- shape; the database only insists that it is an object. Needs 0001_init.

create table if not exists public.store_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  value jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.store_settings enable row level security;

drop policy if exists "Store settings are public" on public.store_settings;
create policy "Store settings are public"
  on public.store_settings
  for select
  using (true);

drop policy if exists "Store settings insert for owner" on public.store_settings;
create policy "Store settings insert for owner"
  on public.store_settings
  for insert
  with check (public.is_shop_owner());

drop policy if exists "Store settings update for owner" on public.store_settings;
create policy "Store settings update for owner"
  on public.store_settings
  for update
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

drop policy if exists "Store settings delete for owner" on public.store_settings;
create policy "Store settings delete for owner"
  on public.store_settings
  for delete
  using (public.is_shop_owner());

revoke all on public.store_settings from anon, authenticated;
grant select on public.store_settings to anon, authenticated;
grant insert, update, delete on public.store_settings to authenticated;

-- updated_at follows every write, whatever the client sent.
drop trigger if exists store_settings_touch_updated_at on public.store_settings;
create trigger store_settings_touch_updated_at
before update on public.store_settings
for each row
execute function public.touch_updated_at();
