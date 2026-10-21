-- Track which promo code was applied to an order
alter table public.orders
  add column if not exists voucher_code text;

create index if not exists idx_orders_voucher_code on public.orders(voucher_code);
