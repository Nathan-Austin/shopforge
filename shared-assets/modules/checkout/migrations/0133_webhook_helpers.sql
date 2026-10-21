-- Webhook helper functions + notifications table + low_stock_threshold

-- 1. Add low_stock_threshold column to products
alter table public.products
  add column if not exists low_stock_threshold integer not null default 3;

-- 2. Notifications table (for in-app alerts e.g. low stock)
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  message    text not null,
  type       text not null default 'info', -- 'info', 'warning', 'error'
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "Notifications select own" on public.notifications
  for select using (auth.uid() = user_id or (select public.is_shop_owner()));

create policy "Notifications update own" on public.notifications
  for update using (auth.uid() = user_id);

create index if not exists idx_notifications_user on public.notifications(user_id);
create index if not exists idx_notifications_unread on public.notifications(user_id, is_read);

-- 3. reduce_stock(p_name, p_quantity)
--    Decrements stock for a product by name. Returns the updated row (id, stock, low_stock_threshold).
drop function if exists public.reduce_stock(text, integer);
create or replace function public.reduce_stock(p_name text, p_quantity integer)
returns table(id uuid, stock integer, low_stock_threshold integer)
language plpgsql
security definer
as $$
begin
  return query
  update public.products
  set stock = greatest(stock - p_quantity, 0)
  where name = p_name
  returning products.id, products.stock, products.low_stock_threshold;
end;
$$;

-- 4. increment_voucher_redemption(p_promo_code_id)
--    Increments redemptions_count on the voucher matching the Stripe promo code ID.
create or replace function public.increment_voucher_redemption(p_promo_code_id text)
returns void
language plpgsql
security definer
as $$
begin
  update public.vouchers
  set redemptions_count = redemptions_count + 1
  where stripe_promo_code_id = p_promo_code_id;
end;
$$;
