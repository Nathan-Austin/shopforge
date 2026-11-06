-- 0002_orders: orders and order_items (2026-11-03).
--
-- Paid orders written by the Stripe webhook, their line items, the guest
-- order claim, the owner-only status change and the popular-products view.
-- Needs 0001_init.

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

