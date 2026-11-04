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
  heat_level integer,
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
  heat_level integer,
  scoville_shu integer,
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

create table if not exists public.products_chilli_types (
  product_id uuid references public.products(id) on delete cascade,
  chilli_type_id uuid references public.chilli_types(id) on delete cascade,
  primary key (product_id, chilli_type_id)
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
create index if not exists idx_chilli_types_slug on public.chilli_types(slug);
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
  p.heat_level,
  p.scoville_shu,
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
  -- ISO 3166-1 alpha-2, uppercase, whichever side collected the address.
  shipping_country text
    check (shipping_country is null or shipping_country ~ '^[A-Z]{2}$'),
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

-- The shop owner moves an order through its lifecycle from the admin. Only
-- the status column is writable, and only by the owner: there is no update
-- policy on orders, so this function is the single way to change one.
-- Superseded further down by the five-argument version (tracking details);
-- kept here so the file reads in order of how the schema grew.
create or replace function public.set_order_status(
  p_order_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can change an order status'
      using errcode = '42501';
  end if;

  if p_status not in ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded') then
    raise exception 'Unknown order status: %', p_status
      using errcode = '22023';
  end if;

  update public.orders
     set status = p_status
   where id = p_order_id;

  if not found then
    raise exception 'Order not found'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;

-- Set by the webhook once the confirmation email is away, so a retried
-- delivery does not email the customer a second time, and so the shop
-- owner can see which orders were never confirmed.
alter table public.orders
  add column if not exists confirmation_sent_at timestamptz;

-- Units sold per product over the last 90 days, for the shop's "popular"
-- sort. A rolling window, so a bestseller from two years ago does not sit
-- at the top forever. An aggregate only: no order, customer or price data
-- leaves the orders tables. Paid and fulfilled orders count; cancelled and
-- refunded ones do not. Like products_public, the view runs with its
-- owner's rights so it is readable without opening the orders tables. A
-- store that imports its recent order history into orders/order_items gets
-- a working "popular" sort straight away.
drop view if exists public.product_sales;
create view public.product_sales as
select oi.product_id, sum(oi.quantity)::integer as units_sold
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
 where o.status in ('paid', 'fulfilled')
   and o.created_at > now() - interval '90 days'
   and oi.product_id is not null
 group by oi.product_id;

grant select on public.product_sales to anon, authenticated;

-- Refunds ---------------------------------------------------------------------

-- How much of an order has gone back to the customer, in the order's
-- currency. Status becomes 'refunded' only when this reaches total_cents;
-- a partial refund leaves the status alone and shows the amount instead.
alter table public.orders
  add column if not exists refunded_cents integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_refunded_cents_within_total'
  ) then
    alter table public.orders
      add constraint orders_refunded_cents_within_total
      check (refunded_cents >= 0 and refunded_cents <= total_cents);
  end if;
end $$;

-- One row per refund attempt: what was asked for, what Stripe did, and
-- whether the customer was told. Written only through the functions below
-- (owner-checked), never through the Data API.
create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  -- full: the rest of the order. items: chosen lines. percent / amount: as typed.
  kind text not null check (kind in ('full', 'items', 'percent', 'amount')),
  percent numeric(5,2),
  -- Snapshot of the refunded lines: [{orderItemId, productName, quantity, amountCents}]
  items jsonb not null default '[]'::jsonb,
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed')),
  stripe_refund_id text unique,
  failure_message text,
  created_by uuid references public.profiles(id) on delete set null,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_order_refunds_order on public.order_refunds(order_id);

alter table public.order_refunds enable row level security;

drop policy if exists "Order refunds select for owner" on public.order_refunds;
create policy "Order refunds select for owner"
  on public.order_refunds
  for select
  using (public.is_shop_owner());

drop policy if exists "Order refunds select own" on public.order_refunds;
create policy "Order refunds select own"
  on public.order_refunds
  for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_refunds.order_id
        and o.user_id is not null
        and o.user_id = auth.uid()
    )
  );

revoke all on public.order_refunds from anon, authenticated;
grant select on public.order_refunds to authenticated;

-- Step 1 of a refund: reserve the amount before Stripe is called. Locks the
-- order row so two admins cannot both refund the last euro, and counts
-- recent pending attempts as spoken for. A pending row older than an hour
-- is treated as abandoned (the app crashed between here and Stripe); the
-- owner can see it in the order's refund history and check Stripe.
create or replace function public.begin_order_refund(
  p_order_id uuid,
  p_amount_cents integer,
  p_kind text,
  p_items jsonb,
  p_percent numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_reserved integer;
  v_id uuid;
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can refund an order'
      using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Refund amount must be positive'
      using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if v_order.status not in ('paid', 'fulfilled') then
    raise exception 'Order % cannot be refunded in status %', p_order_id, v_order.status
      using errcode = '22023';
  end if;

  select coalesce(sum(amount_cents), 0)
    into v_reserved
    from public.order_refunds
   where order_id = p_order_id
     and status = 'pending'
     and created_at > now() - interval '1 hour';

  if v_order.refunded_cents + v_reserved + p_amount_cents > v_order.total_cents then
    raise exception 'Refund exceeds what is left of the order'
      using errcode = '22023';
  end if;

  insert into public.order_refunds
    (order_id, amount_cents, currency, kind, items, percent, reason, created_by)
  values
    (p_order_id, p_amount_cents, v_order.currency, p_kind,
     coalesce(p_items, '[]'::jsonb), p_percent, nullif(trim(p_reason), ''), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Step 2: Stripe accepted the refund. Records its id, adds the amount to
-- the order, and marks the order refunded once nothing is left.
create or replace function public.complete_order_refund(
  p_refund_id uuid,
  p_stripe_refund_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_amount integer;
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can refund an order'
      using errcode = '42501';
  end if;

  update public.order_refunds
     set status = 'succeeded',
         stripe_refund_id = p_stripe_refund_id,
         completed_at = now()
   where id = p_refund_id
     and status = 'pending'
  returning order_id, amount_cents into v_order_id, v_amount;

  if not found then
    raise exception 'Refund % is not pending', p_refund_id using errcode = 'P0002';
  end if;

  update public.orders
     set refunded_cents = refunded_cents + v_amount,
         status = case
           when refunded_cents + v_amount >= total_cents then 'refunded'
           else status
         end
   where id = v_order_id;
end;
$$;

-- Step 2, the other branch: Stripe refused or could not be reached. The
-- reservation is released and the reason kept for the owner.
create or replace function public.fail_order_refund(
  p_refund_id uuid,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can refund an order'
      using errcode = '42501';
  end if;

  update public.order_refunds
     set status = 'failed',
         failure_message = left(coalesce(p_message, ''), 500),
         completed_at = now()
   where id = p_refund_id
     and status = 'pending';
end;
$$;

-- Step 3: the customer has been emailed.
create or replace function public.mark_order_refund_emailed(p_refund_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can refund an order'
      using errcode = '42501';
  end if;

  update public.order_refunds
     set email_sent_at = now()
   where id = p_refund_id;
end;
$$;

revoke all on function public.begin_order_refund(uuid, integer, text, jsonb, numeric, text) from public, anon;
revoke all on function public.complete_order_refund(uuid, text) from public, anon;
revoke all on function public.fail_order_refund(uuid, text) from public, anon;
revoke all on function public.mark_order_refund_emailed(uuid) from public, anon;
grant execute on function public.begin_order_refund(uuid, integer, text, jsonb, numeric, text) to authenticated;
grant execute on function public.complete_order_refund(uuid, text) to authenticated;
grant execute on function public.fail_order_refund(uuid, text) to authenticated;
grant execute on function public.mark_order_refund_emailed(uuid) to authenticated;

-- Shipping and notifications ---------------------------------------------------

-- The locale the customer checked out in, so emails sent later (shipping,
-- refunds) can be in their language rather than the owner's.
alter table public.orders
  add column if not exists locale text;

-- Tracking details the owner enters when marking an order shipped, when the
-- parcel left, and when the customer was told. shipping_notified_at is the
-- guard against emailing twice: flipping the status back and forth does not
-- email again once it is set.
alter table public.orders
  add column if not exists tracking_carrier text,
  add column if not exists tracking_number text,
  add column if not exists tracking_url text,
  add column if not exists shipped_at timestamptz,
  add column if not exists shipping_notified_at timestamptz;

-- The status function gains optional tracking details. The old two-argument
-- signature is dropped so there is one function; callers that pass two
-- arguments still work through the defaults. 'refunded' is no longer
-- settable by hand: the refund flow sets it once the money has moved.
drop function if exists public.set_order_status(uuid, text);
create or replace function public.set_order_status(
  p_order_id uuid,
  p_status text,
  p_tracking_carrier text default null,
  p_tracking_number text default null,
  p_tracking_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can change an order status'
      using errcode = '42501';
  end if;

  if p_status not in ('pending', 'paid', 'fulfilled', 'cancelled') then
    raise exception 'Status % cannot be set by hand', p_status
      using errcode = '22023';
  end if;

  if p_tracking_url is not null and p_tracking_url !~* '^https?://' then
    raise exception 'Tracking link must start with http:// or https://'
      using errcode = '22023';
  end if;

  update public.orders
     set status = p_status,
         -- Tracking is only meaningful on a shipped order; saving it with
         -- another status would be a mistake, so it is left alone then.
         tracking_carrier = case when p_status = 'fulfilled'
           then nullif(trim(p_tracking_carrier), '') else tracking_carrier end,
         tracking_number = case when p_status = 'fulfilled'
           then nullif(trim(p_tracking_number), '') else tracking_number end,
         tracking_url = case when p_status = 'fulfilled'
           then nullif(trim(p_tracking_url), '') else tracking_url end,
         shipped_at = case when p_status = 'fulfilled'
           then coalesce(shipped_at, now()) else shipped_at end
   where id = p_order_id;

  if not found then
    raise exception 'Order not found'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_order_status(uuid, text, text, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text, text, text, text) to authenticated;

-- Recorded once the shipping email is away.
create or replace function public.mark_order_shipping_notified(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can change an order'
      using errcode = '42501';
  end if;

  update public.orders
     set shipping_notified_at = now()
   where id = p_order_id;
end;
$$;

revoke all on function public.mark_order_shipping_notified(uuid) from public, anon;
grant execute on function public.mark_order_shipping_notified(uuid) to authenticated;
