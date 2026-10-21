-- Create Vouchers table for local tracking and UI
create type public.discount_type as enum ('percentage', 'fixed');
create type public.voucher_duration as enum ('once', 'repeating', 'forever');

create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  stripe_coupon_id text unique,
  stripe_promo_code_id text unique,
  
  discount_type public.discount_type not null default 'percentage',
  amount integer not null, -- percentage (0-100) or amount in cents
  currency text not null default 'EUR',
  
  duration public.voucher_duration not null default 'once',
  duration_in_months integer, -- only if repeating
  
  max_redemptions integer,
  redemptions_count integer not null default 0,
  
  first_time_only boolean not null default false,
  expires_at timestamptz,
  
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.vouchers enable row level security;

create policy "Vouchers select shop owner" on public.vouchers
  for select using (public.is_shop_owner());

create policy "Vouchers manage shop owner" on public.vouchers
  for all using (public.is_shop_owner()) with check (public.is_shop_owner());

-- Trigger for updated_at
create trigger trg_vouchers_updated
before update on public.vouchers
for each row
execute function public.touch_updated_at();

create index if not exists idx_vouchers_code on public.vouchers(code);
create index if not exists idx_vouchers_active on public.vouchers(is_active);
