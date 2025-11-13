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

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id),
  name text not null,
  slug text not null unique,
  description text,
  logo_url text,
  website text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id),
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
  price_cents integer not null,
  currency text not null default 'GBP',
  image_url text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_generic_products_brand on public.products(brand_id);
create index if not exists idx_generic_products_category on public.products(category_id);
create index if not exists idx_generic_products_slug on public.products(slug);
create index if not exists idx_generic_categories_slug on public.categories(slug);
create index if not exists idx_generic_brands_slug on public.brands(slug);

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

drop trigger if exists trg_generic_products_owner on public.products;
create trigger trg_generic_products_owner
before insert on public.products
for each row
execute function public.set_product_owner();

drop trigger if exists trg_generic_products_updated on public.products;
create trigger trg_generic_products_updated
before update on public.products
for each row
execute function public.touch_updated_at();

drop trigger if exists trg_generic_profiles_updated on public.profiles;
create trigger trg_generic_profiles_updated
before update on public.profiles
for each row
execute function public.touch_updated_at();

drop trigger if exists trg_generic_brands_updated on public.brands;
create trigger trg_generic_brands_updated
before update on public.brands
for each row
execute function public.touch_updated_at();

drop trigger if exists trg_generic_categories_updated on public.categories;
create trigger trg_generic_categories_updated
before update on public.categories
for each row
execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;

drop policy if exists "Generic profiles select" on public.profiles;
create policy "Generic profiles select"
  on public.profiles
  for select
  using (auth.uid() = id);

drop policy if exists "Generic profiles insert" on public.profiles;
create policy "Generic profiles insert"
  on public.profiles
  for insert
  with check (auth.uid() = id);

drop policy if exists "Generic profiles update" on public.profiles;
create policy "Generic profiles update"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Generic brands select" on public.brands;
create policy "Generic brands select"
  on public.brands
  for select
  using (true);

drop policy if exists "Generic brands manage" on public.brands;
create policy "Generic brands manage"
  on public.brands
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

drop policy if exists "Generic categories select" on public.categories;
create policy "Generic categories select"
  on public.categories
  for select
  using (true);

drop policy if exists "Generic categories manage" on public.categories;
create policy "Generic categories manage"
  on public.categories
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

drop policy if exists "Generic products select" on public.products;
create policy "Generic products select"
  on public.products
  for select
  using (true);

drop policy if exists "Generic products manage" on public.products;
create policy "Generic products manage"
  on public.products
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());
