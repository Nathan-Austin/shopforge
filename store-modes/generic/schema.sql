create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer',
  first_name text,
  last_name text,
  phone text,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  label text,
  street text,
  city text,
  region text,
  postal_code text,
  country text,
  created_at timestamptz default now()
);

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  country text,
  website text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  brand_id uuid references public.brands(id),
  category_id uuid references public.categories(id),
  name text not null,
  slug text not null unique,
  description text,
  details text,
  price_cents integer not null,
  currency text not null default 'EUR',
  image_url text,
  capacity_ml integer,
  ingredients text,
  nutrition_info jsonb,
  size_options text[],
  color_options text[],
  stock integer default 0,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- New table for server-side cart management
create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_session_id uuid not null,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 1,
  selected_size text,
  selected_color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_brand on public.products(brand_id);
create index if not exists idx_products_category on public.products(category_id);
create index if not exists idx_products_owner on public.products(owner_id);
create index if not exists idx_products_slug on public.products(slug);
create index if not exists idx_categories_slug on public.categories(slug);
create index if not exists idx_brands_slug on public.brands(slug);
create index if not exists idx_cart_items_session on public.cart_items(cart_session_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_product_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is null then
    new.owner_id = auth.uid();
  end if;
  if new.owner_id is null then
    raise exception 'owner_id is required';
  end if;
  return new;
end;
$$;

create or replace function public.is_shop_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'shop_owner'
  );
$$;

drop trigger if exists trg_products_owner on public.products;
create trigger trg_products_owner
before insert on public.products
for each row
execute function public.set_product_owner();

drop trigger if exists trg_products_updated on public.products;
create trigger trg_products_updated
before update on public.products
for each row
execute function public.touch_updated_at();

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
before update on public.profiles
for each row
execute function public.touch_updated_at();

drop trigger if exists trg_brands_updated on public.brands;
create trigger trg_brands_updated
before update on public.brands
for each row
execute function public.touch_updated_at();

drop trigger if exists trg_categories_updated on public.categories;
create trigger trg_categories_updated
before update on public.categories
for each row
execute function public.touch_updated_at();

drop trigger if exists trg_cart_items_updated on public.cart_items;
create trigger trg_cart_items_updated
before update on public.cart_items
for each row
execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.addresses enable row level security;
alter table public.brands enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.cart_items enable row level security;

drop policy if exists "Profiles select own" on public.profiles;
create policy "Profiles select own"
  on public.profiles
  for select
  using (auth.uid() = id);

drop policy if exists "Profiles insert own" on public.profiles;
create policy "Profiles insert own"
  on public.profiles
  for insert
  with check (auth.uid() = id);

drop policy if exists "Profiles update own" on public.profiles;
create policy "Profiles update own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- "Profiles update own" covers every column, including role, so without this
-- guard a customer could PATCH {"role":"shop_owner"} with the anon key and their
-- own session. Reject role changes made through the Data API roles; service_role,
-- postgres (SQL editor, migrations) and security-definer functions are unaffected.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT'
       and new.role is distinct from 'customer'
       -- allow an upsert that keeps the caller's existing role unchanged (api/profile)
       and not exists (select 1 from public.profiles p where p.id = new.id and p.role = new.role) then
      raise exception 'Not allowed to set profiles.role' using errcode = '42501';
    end if;

    if tg_op = 'UPDATE' and new.role is distinct from old.role then
      raise exception 'Not allowed to change profiles.role' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_role on public.profiles;
create trigger trg_profiles_guard_role
  before insert or update on public.profiles
  for each row
  execute function public.guard_profile_role();

drop policy if exists "Addresses access" on public.addresses;
create policy "Addresses access"
  on public.addresses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Brands select all" on public.brands;
create policy "Brands select all"
  on public.brands
  for select
  using (true);

drop policy if exists "Brands manage" on public.brands;
create policy "Brands manage"
  on public.brands
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

drop policy if exists "Categories select all" on public.categories;
create policy "Categories select all"
  on public.categories
  for select
  using (true);

drop policy if exists "Categories manage" on public.categories;
create policy "Categories manage"
  on public.categories
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

drop policy if exists "Products select all" on public.products;
create policy "Products select all"
  on public.products
  for select
  using (true);

drop policy if exists "Products manage" on public.products;
create policy "Products manage"
  on public.products
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

-- Auto-create a customer profile on signup. Nobody is promoted automatically:
-- auto-promoting the first signup lets anyone claim the store if it goes live
-- before the owner registers. Promote the owner from the Supabase SQL editor:
--   update public.profiles set role = 'shop_owner'
--    where id = (select id from auth.users where email = 'owner@example.com');
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role)
    values (new.id, 'customer')
    on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- cart_items is server-only. A using (true) policy would let anyone holding the
-- public anon key read or modify every cart through the Data API. All cart
-- access goes through server code using the service-role admin client.
drop policy if exists "Cart items access" on public.cart_items;
drop policy if exists "No public access to cart_items" on public.cart_items;
create policy "No public access to cart_items"
  on public.cart_items
  for all
  using (false)
  with check (false);

revoke all on public.cart_items from anon, authenticated;
