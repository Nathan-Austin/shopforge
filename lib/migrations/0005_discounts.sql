-- 0005_discounts: discount codes (2026-11-04).
--
-- The discount_codes table, the discount columns snapshotted onto an
-- order at payment, and the redemption counter the webhook calls.
-- Needs 0002_orders.

-- Discount codes --------------------------------------------------------------

-- Promo codes the owner creates in the admin. Percent and amount codes are
-- backed by a Stripe coupon plus promotion code, which Stripe applies to
-- the checkout session; free-shipping codes are applied by the shop itself
-- (Stripe coupons cannot zero a shipping rate). The shop validates a code
-- before the session is created so the customer gets a readable reason;
-- Stripe enforces the same limits again on its side.
create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  -- Stored uppercase and trimmed; matched case-insensitively.
  code text not null unique check (code = upper(trim(code)) and code ~ '^[A-Z0-9_-]{3,32}$'),
  kind text not null check (kind in ('percent', 'amount', 'free_shipping')),
  percent_off numeric(5,2) check (percent_off is null or (percent_off > 0 and percent_off <= 100)),
  amount_off_cents integer check (amount_off_cents is null or amount_off_cents > 0),
  -- Required for amount codes and for a minimum subtotal; null means any.
  currency text,
  min_subtotal_cents integer check (min_subtotal_cents is null or min_subtotal_cents >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  active boolean not null default true,
  stripe_coupon_id text,
  stripe_promotion_code_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'percent' and percent_off is not null)
    or (kind = 'amount' and amount_off_cents is not null and currency is not null)
    or (kind = 'free_shipping')
  )
);

drop trigger if exists trg_discount_codes_updated on public.discount_codes;
create trigger trg_discount_codes_updated
before update on public.discount_codes
for each row
execute function public.touch_updated_at();

alter table public.discount_codes enable row level security;

-- Only the owner reads or writes codes through the Data API. Shoppers never
-- see the table: the cart looks a typed code up on the server with the
-- service-role key, so nobody can list the codes that exist.
drop policy if exists "Discount codes manage" on public.discount_codes;
create policy "Discount codes manage"
  on public.discount_codes
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

revoke all on public.discount_codes from anon, authenticated;
grant select, insert, update, delete on public.discount_codes to authenticated;

-- What the order got off and with which code, snapshotted at payment.
alter table public.orders
  add column if not exists discount_code text,
  add column if not exists discount_cents integer not null default 0 check (discount_cents >= 0);

-- Called by the webhook (service role) when a paid session used a code.
-- One statement, so two orders landing together both count.
create or replace function public.record_discount_redemption(p_code text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.discount_codes
     set redemption_count = redemption_count + 1
   where code = upper(trim(p_code));
$$;

revoke all on function public.record_discount_redemption(text) from public, anon, authenticated;

