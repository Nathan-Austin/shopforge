-- Store the actual discount amount applied to an order (voucher_code alone
-- told us a code was used, but not how much it saved).
alter table public.orders add column if not exists discount_cents integer not null default 0;

-- Backfill past orders that already captured a voucher_code: the discount is
-- implicit in subtotal + shipping + tax - total (tax is calculated off the
-- pre-discount subtotal, so it doesn't net out on its own).
update public.orders
set discount_cents = greatest(subtotal_cents + shipping_cents + tax_cents - total_cents, 0)
where voucher_code is not null
  and discount_cents = 0;
