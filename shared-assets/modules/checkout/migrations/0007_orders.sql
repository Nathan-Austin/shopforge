-- Create orders and order items tables

do $$ 
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum ('pending', 'paid', 'shipped', 'cancelled', 'refunded');
  end if;
end $$;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  stripe_session_id text unique,
  stripe_payment_intent_id text unique,
  status public.order_status not null default 'pending',
  
  -- Totals in cents
  subtotal_cents integer not null,
  shipping_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null,
  
  -- Shipping Address (Snapshot at time of order)
  customer_email text not null,
  shipping_name text,
  shipping_street text,
  shipping_city text,
  shipping_postal_code text,
  shipping_country text,
  
  -- Metadata
  currency text not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  
  -- Snapshot of product info at time of order
  product_name text not null,
  quantity integer not null default 1,
  price_cents integer not null,
  tax_cents integer not null default 0,
  selected_size text,
  selected_color text,
  
  created_at timestamptz not null default now()
);

-- RLS
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Orders select own" on public.orders;
create policy "Orders select own" on public.orders
  for select using (auth.uid() = user_id or (select public.is_shop_owner()));

drop policy if exists "Order items select own" on public.order_items;
create policy "Order items select own" on public.order_items
  for select using (
    exists (
      select 1 from public.orders 
      where id = order_id and (user_id = auth.uid() or (select public.is_shop_owner()))
    )
  );

-- Indexes
create index if not exists idx_orders_user on public.orders(user_id);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_order_items_order on public.order_items(order_id);

-- Trigger for updated_at
drop trigger if exists trg_orders_updated on public.orders;
create trigger trg_orders_updated
before update on public.orders
for each row
execute function public.touch_updated_at();
