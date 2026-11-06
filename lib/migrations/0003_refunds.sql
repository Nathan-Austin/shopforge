-- 0003_refunds: the refund ledger (2026-11-04).
--
-- orders.refunded_cents, the order_refunds ledger and the four functions
-- that move a refund through reserve -> Stripe -> record/fail -> emailed.
-- Needs 0002_orders.

-- Refunds ---------------------------------------------------------------------

-- How much of an order has gone back to the customer, in the order's
-- currency. Status becomes 'refunded' only when this reaches total_cents;
-- a partial refund leaves the status alone and shows the amount instead.
alter table public.orders
  add column if not exists refunded_cents integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_refunded_cents_within_total'
  ) then
    alter table public.orders
      add constraint orders_refunded_cents_within_total
      check (refunded_cents >= 0 and refunded_cents <= total_cents);
  end if;
end $$;

-- One row per refund attempt: what was asked for, what Stripe did, and
-- whether the customer was told. Written only through the functions below
-- (owner-checked), never through the Data API.
create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  -- full: the rest of the order. items: chosen lines. percent / amount: as typed.
  kind text not null check (kind in ('full', 'items', 'percent', 'amount')),
  percent numeric(5,2),
  -- Snapshot of the refunded lines: [{orderItemId, productName, quantity, amountCents}]
  items jsonb not null default '[]'::jsonb,
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed')),
  stripe_refund_id text unique,
  failure_message text,
  created_by uuid references public.profiles(id) on delete set null,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_order_refunds_order on public.order_refunds(order_id);

alter table public.order_refunds enable row level security;

drop policy if exists "Order refunds select for owner" on public.order_refunds;
create policy "Order refunds select for owner"
  on public.order_refunds
  for select
  using (public.is_shop_owner());

drop policy if exists "Order refunds select own" on public.order_refunds;
create policy "Order refunds select own"
  on public.order_refunds
  for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_refunds.order_id
        and o.user_id is not null
        and o.user_id = auth.uid()
    )
  );

revoke all on public.order_refunds from anon, authenticated;
grant select on public.order_refunds to authenticated;

-- Step 1 of a refund: reserve the amount before Stripe is called. Locks the
-- order row so two admins cannot both refund the last euro, and counts
-- recent pending attempts as spoken for. A pending row older than an hour
-- is treated as abandoned (the app crashed between here and Stripe); the
-- owner can see it in the order's refund history and check Stripe.
create or replace function public.begin_order_refund(
  p_order_id uuid,
  p_amount_cents integer,
  p_kind text,
  p_items jsonb,
  p_percent numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_reserved integer;
  v_id uuid;
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can refund an order'
      using errcode = '42501';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Refund amount must be positive'
      using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if v_order.status not in ('paid', 'fulfilled') then
    raise exception 'Order % cannot be refunded in status %', p_order_id, v_order.status
      using errcode = '22023';
  end if;

  select coalesce(sum(amount_cents), 0)
    into v_reserved
    from public.order_refunds
   where order_id = p_order_id
     and status = 'pending'
     and created_at > now() - interval '1 hour';

  if v_order.refunded_cents + v_reserved + p_amount_cents > v_order.total_cents then
    raise exception 'Refund exceeds what is left of the order'
      using errcode = '22023';
  end if;

  insert into public.order_refunds
    (order_id, amount_cents, currency, kind, items, percent, reason, created_by)
  values
    (p_order_id, p_amount_cents, v_order.currency, p_kind,
     coalesce(p_items, '[]'::jsonb), p_percent, nullif(trim(p_reason), ''), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Step 2: Stripe accepted the refund. Records its id, adds the amount to
-- the order, and marks the order refunded once nothing is left.
create or replace function public.complete_order_refund(
  p_refund_id uuid,
  p_stripe_refund_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_amount integer;
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can refund an order'
      using errcode = '42501';
  end if;

  update public.order_refunds
     set status = 'succeeded',
         stripe_refund_id = p_stripe_refund_id,
         completed_at = now()
   where id = p_refund_id
     and status = 'pending'
  returning order_id, amount_cents into v_order_id, v_amount;

  if not found then
    raise exception 'Refund % is not pending', p_refund_id using errcode = 'P0002';
  end if;

  update public.orders
     set refunded_cents = refunded_cents + v_amount,
         status = case
           when refunded_cents + v_amount >= total_cents then 'refunded'
           else status
         end
   where id = v_order_id;
end;
$$;

-- Step 2, the other branch: Stripe refused or could not be reached. The
-- reservation is released and the reason kept for the owner.
create or replace function public.fail_order_refund(
  p_refund_id uuid,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can refund an order'
      using errcode = '42501';
  end if;

  update public.order_refunds
     set status = 'failed',
         failure_message = left(coalesce(p_message, ''), 500),
         completed_at = now()
   where id = p_refund_id
     and status = 'pending';
end;
$$;

-- Step 3: the customer has been emailed.
create or replace function public.mark_order_refund_emailed(p_refund_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can refund an order'
      using errcode = '42501';
  end if;

  update public.order_refunds
     set email_sent_at = now()
   where id = p_refund_id;
end;
$$;

revoke all on function public.begin_order_refund(uuid, integer, text, jsonb, numeric, text) from public, anon;
revoke all on function public.complete_order_refund(uuid, text) from public, anon;
revoke all on function public.fail_order_refund(uuid, text) from public, anon;
revoke all on function public.mark_order_refund_emailed(uuid) from public, anon;
grant execute on function public.begin_order_refund(uuid, integer, text, jsonb, numeric, text) to authenticated;
grant execute on function public.complete_order_refund(uuid, text) to authenticated;
grant execute on function public.fail_order_refund(uuid, text) to authenticated;
grant execute on function public.mark_order_refund_emailed(uuid) to authenticated;

