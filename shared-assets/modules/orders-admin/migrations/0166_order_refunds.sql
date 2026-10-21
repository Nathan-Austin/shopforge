-- Refund support for the admin orders dashboard. Refunds are processed via
-- Stripe (stripe.refunds.create against the order's payment_intent) from a
-- server action using the admin client, so no INSERT/UPDATE/DELETE policy is
-- needed here -- writes always go through service_role, same pattern as
-- markOrderShipped.

alter type order_status add value if not exists 'partially_refunded';

alter table public.orders
  add column if not exists refunded_cents integer not null default 0;

-- One row per refund actually issued (an order can be partially refunded
-- more than once), so the order detail page can show a full history rather
-- than just a running total.
create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  stripe_refund_id text not null,
  amount_cents integer not null,
  reason text,
  -- Snapshot of which line items/quantities this refund covered, when the
  -- item-picker (rather than a manual override amount) was used.
  items jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.order_refunds enable row level security;

create policy "Order refunds select own or shop owner"
  on public.order_refunds for select
  using (
    exists (
      select 1 from public.orders
      where orders.id = order_refunds.order_id
        and (orders.user_id = (select auth.uid()) or (select is_shop_owner()))
    )
  );

grant select on public.order_refunds to authenticated;
grant all on public.order_refunds to service_role;
