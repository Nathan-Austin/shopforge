-- Per-customer, single-use discount codes (Stripe max_redemptions = 1),
-- generated on demand instead of handing out one shared static code.
create table if not exists public.one_time_discount_codes (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('review_reminder', 'newsletter_welcome')),
  email text not null,
  order_id uuid references public.orders(id) on delete set null,
  code text not null unique,
  stripe_coupon_id text not null,
  stripe_promo_code_id text not null unique,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.one_time_discount_codes enable row level security;

create policy "One-time codes select shop owner" on public.one_time_discount_codes
  for select using (public.is_shop_owner());

create index if not exists idx_one_time_discount_codes_email on public.one_time_discount_codes(email);
create index if not exists idx_one_time_discount_codes_promo on public.one_time_discount_codes(stripe_promo_code_id);
