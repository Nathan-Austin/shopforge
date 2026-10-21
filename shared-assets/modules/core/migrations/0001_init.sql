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

create table if not exists public.chilli_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  heat_level text,
  description text,
  created_at timestamptz default now()
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
  heat_level text,
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

create table if not exists public.products_chilli_types (
  product_id uuid references public.products(id) on delete cascade,
  chilli_type_id uuid references public.chilli_types(id) on delete cascade,
  primary key (product_id, chilli_type_id)
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
create index if not exists idx_chilli_types_slug on public.chilli_types(slug);
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
alter table public.chilli_types enable row level security;
alter table public.products enable row level security;
alter table public.products_chilli_types enable row level security;
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

drop policy if exists "Chilli types select all" on public.chilli_types;
create policy "Chilli types select all"
  on public.chilli_types
  for select
  using (true);

drop policy if exists "Chilli types manage" on public.chilli_types;
create policy "Chilli types manage"
  on public.chilli_types
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

drop policy if exists "Product chilli select" on public.products_chilli_types;
create policy "Product chilli select"
  on public.products_chilli_types
  for select
  using (true);

drop policy if exists "Product chilli manage" on public.products_chilli_types;
create policy "Product chilli manage"
  on public.products_chilli_types
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

-- RLS for cart_items (accessible by anyone with the session ID)
drop policy if exists "Cart items access" on public.cart_items;
create policy "Cart items access"
  on public.cart_items
  for all
  using (true)
  with check (true);
