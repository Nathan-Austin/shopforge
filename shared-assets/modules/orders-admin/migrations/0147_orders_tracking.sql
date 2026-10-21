alter table public.orders
  add column if not exists tracking_number text,
  add column if not exists tracking_carrier text;
