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
  ingredients text,
  headline text,
  compare_at_price_cents integer,
  cost_price_cents integer,
  tax_rate_percent numeric(5,2),
  sku text,
  barcode text,
  track_inventory boolean default false,
  allow_backorder boolean default false,
  max_order_quantity integer,
  is_featured boolean default false,
  archived_at timestamptz,
  net_content numeric(10,2),
  net_content_unit text,
  weight_grams integer,
  dimensions_mm jsonb,
  allergens text[],
  dietary_flags text[],
  storage_instructions text,
  best_before_text text,
  gallery_urls text[],
  video_url text,
  tags text[],
  country_of_origin text,
  meta_title text,
  meta_description text,
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
  -- Guest carts are keyed by the id in the shop_cart_session cookie. Once
  -- someone signs in their lines are also stamped with user_id, so the cart
  -- follows them to another device.
  cart_session_id uuid not null,
  user_id uuid references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  selected_size text,
  selected_color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One line per product variant per cart. selected_size and selected_color are
-- nullable and Postgres treats nulls as distinct, so coalesce them to '' or
-- the same variant could be added twice.
create unique index if not exists idx_cart_items_unique_line
  on public.cart_items (
    cart_session_id,
    product_id,
    coalesce(selected_size, ''),
    coalesce(selected_color, '')
  );

create index if not exists idx_products_brand on public.products(brand_id);
create index if not exists idx_products_category on public.products(category_id);
create index if not exists idx_products_owner on public.products(owner_id);
create index if not exists idx_products_slug on public.products(slug);
create index if not exists idx_categories_slug on public.categories(slug);
create index if not exists idx_brands_slug on public.brands(slug);
create index if not exists idx_cart_items_session on public.cart_items(cart_session_id);
create index if not exists idx_cart_items_user on public.cart_items(user_id);

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

-- The products table is no longer world-readable. It holds supplier-only
-- columns (cost_price_cents, sku, barcode) and unpublished rows, and the anon
-- key is public, so a `using (true)` select policy would hand a competitor
-- every margin through the Data API. Only the shop owner reads the table
-- directly, via the "Products manage" policy below; the storefront reads the
-- products_public view instead.
drop policy if exists "Products select all" on public.products;

-- Storefront view: published, unarchived rows and no supplier fields.
-- The view runs with its owner's rights, so it is readable without granting
-- access to the underlying table. Category name and slug are joined in
-- because PostgREST cannot embed a relation through a view.
drop view if exists public.products_public;
create view public.products_public as
select
  p.id,
  p.name,
  p.slug,
  p.headline,
  p.description,
  p.details,
  p.image_url,
  p.gallery_urls,
  p.video_url,
  p.price_cents,
  p.compare_at_price_cents,
  p.currency,
  p.tax_rate_percent,
  p.category_id,
  p.brand_id,
  p.stock,
  p.track_inventory,
  p.allow_backorder,
  p.max_order_quantity,
  p.size_options,
  p.color_options,
  p.net_content,
  p.net_content_unit,
  p.weight_grams,
  p.dimensions_mm,
  p.ingredients,
  p.allergens,
  p.nutrition_info,
  p.dietary_flags,
  p.storage_instructions,
  p.best_before_text,
  p.tags,
  p.country_of_origin,
  p.meta_title,
  p.meta_description,
  p.is_featured,
  p.created_at,
  p.updated_at,
  c.name as category_name,
  c.slug as category_slug,
  b.name as brand_name,
  b.slug as brand_slug
from public.products p
left join public.categories c on c.id = p.category_id
left join public.brands b on b.id = p.brand_id
where p.is_active is not false
  and p.archived_at is null;

grant select on public.products_public to anon, authenticated;

-- Stripe webhook bookkeeping -------------------------------------------------

-- Stripe retries deliveries and can send the same event more than once, so
-- every event id is recorded before it is acted on. Without this a retry
-- would decrement stock twice for one order.
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

-- Written only by the webhook, which uses the service-role key.
drop policy if exists "No public access to stripe_events" on public.stripe_events;
create policy "No public access to stripe_events"
  on public.stripe_events
  for all
  using (false)
  with check (false);

revoke all on public.stripe_events from anon, authenticated;

-- Decrement stock in one statement so two orders landing together cannot both
-- read the old value and oversell. Shops that don't track inventory are left
-- alone, and stock never goes below zero.
create or replace function public.decrement_product_stock(
  p_product_id uuid,
  p_quantity integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products
     set stock = greatest(0, coalesce(stock, 0) - greatest(0, p_quantity)),
         updated_at = now()
   where id = p_product_id
     and track_inventory is true;
end;
$$;

revoke all on function public.decrement_product_stock(uuid, integer) from anon, authenticated;

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

-- Orders ---------------------------------------------------------------------

-- An order is written by the Stripe webhook once a payment has succeeded, and
-- never by the browser. Prices, names and the address are copied onto the
-- order at that moment so editing or deleting a product later does not
-- rewrite history.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Null for guest checkouts. A guest can later sign up with the same email
  -- and have the order attached to their account.
  user_id uuid references public.profiles(id) on delete set null,
  email text not null,
  status text not null default 'paid'
    check (status in ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')),
  currency text not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  shipping_cents integer not null default 0 check (shipping_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  -- One session, one order: this is the second line of defence after
  -- stripe_events against a retried webhook creating a duplicate.
  stripe_session_id text not null unique,
  stripe_payment_intent_id text,
  -- Delivery details as Stripe reported them when the payment completed,
  -- whether they were typed into our checkout form or into Stripe's.
  shipping_name text,
  shipping_line1 text,
  shipping_line2 text,
  shipping_city text,
  shipping_postal_code text,
  shipping_region text,
  shipping_country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  -- Kept as a pointer only: the row below is the record of what was sold.
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity > 0),
  selected_size text,
  selected_color text,
  created_at timestamptz not null default now()
);

create index if not exists idx_orders_user on public.orders(user_id);
create index if not exists idx_orders_email on public.orders(lower(email));
create index if not exists idx_order_items_order on public.order_items(order_id);

drop trigger if exists trg_orders_updated on public.orders;
create trigger trg_orders_updated
before update on public.orders
for each row
execute function public.touch_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Customers read their own orders; the shop owner reads every order. Guest
-- orders have no user_id and so are invisible through the Data API until
-- they are attached to an account. Nobody writes through the Data API: the
-- webhook inserts with the service-role key.
drop policy if exists "Orders select own" on public.orders;
create policy "Orders select own"
  on public.orders
  for select
  using (user_id is not null and auth.uid() = user_id);

drop policy if exists "Orders select all for owner" on public.orders;
create policy "Orders select all for owner"
  on public.orders
  for select
  using (public.is_shop_owner());

drop policy if exists "Order items select own" on public.order_items;
create policy "Order items select own"
  on public.order_items
  for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.user_id is not null
        and o.user_id = auth.uid()
    )
  );

drop policy if exists "Order items select all for owner" on public.order_items;
create policy "Order items select all for owner"
  on public.order_items
  for select
  using (public.is_shop_owner());

revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;

-- A guest who paid with an email address and later signs up with the same
-- one gets their orders attached to the new account. The match is only made
-- once the address is confirmed, otherwise anyone could register with a
-- stranger's email and read their order history before clicking the link.
-- Returns the number of orders attached.
create or replace function public.claim_guest_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_count integer;
begin
  select u.email
    into v_email
    from auth.users u
   where u.id = auth.uid()
     and u.email_confirmed_at is not null;

  if v_email is null then
    return 0;
  end if;

  update public.orders
     set user_id = auth.uid()
   where user_id is null
     and lower(email) = lower(v_email);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_guest_orders() from public, anon;
grant execute on function public.claim_guest_orders() to authenticated;
