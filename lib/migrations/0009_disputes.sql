-- 0009_disputes: chargebacks, and refunds made outside the admin (2026-11-06).
--
-- Two things the shop only learns about from a webhook:
--
--   * a refund issued from the Stripe dashboard, which the admin's own
--     refund flow never recorded, and
--   * a dispute (chargeback), where the customer's bank pulls the money
--     back and the owner has a deadline to answer.
--
-- Both are reconciled from what Stripe reports rather than added up locally,
-- so a retried or out-of-order delivery cannot double-count. Needs 0003_refunds.

-- The webhook looks orders up by payment intent; until now nothing did.
create index if not exists idx_orders_payment_intent
  on public.orders(stripe_payment_intent_id);

-- 'disputed' joins the statuses. Like 'refunded' it is never settable by
-- hand: set_order_status still refuses anything outside its own list, so
-- only the webhook below can put an order here.
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.orders'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%status%'
     and pg_get_constraintdef(oid) like '%pending%';
  if v_name is not null then
    execute format('alter table public.orders drop constraint %I', v_name);
  end if;
end $$;

alter table public.orders
  add constraint orders_status_check
  check (status in ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded', 'disputed'));

-- One row per Stripe dispute. The shop owner's alone: a chargeback is
-- between the shop and the card network, and showing it to the customer
-- who raised it would help nobody.
create table if not exists public.order_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  stripe_dispute_id text not null unique,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null,
  -- Stripe's own reason ('fraudulent', 'product_not_received', ...). Free
  -- text on purpose: the list grows and an unknown value must not fail a
  -- webhook that is already being retried.
  reason text,
  -- Stripe's dispute status, likewise kept as it comes.
  status text not null,
  -- When evidence is due. The owner's actual deadline.
  evidence_due_at timestamptz,
  -- What the order was before the dispute opened, so winning restores it
  -- instead of guessing 'paid'.
  previous_order_status text,
  -- Set once the owner has been told, so a retry does not email twice.
  notified_at timestamptz,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_order_disputes_order on public.order_disputes(order_id);

drop trigger if exists trg_order_disputes_updated on public.order_disputes;
create trigger trg_order_disputes_updated
before update on public.order_disputes
for each row
execute function public.touch_updated_at();

alter table public.order_disputes enable row level security;

drop policy if exists "Order disputes read for owner" on public.order_disputes;
create policy "Order disputes read for owner"
  on public.order_disputes
  for select
  using (public.is_shop_owner());

revoke all on public.order_disputes from anon, authenticated;
grant select on public.order_disputes to authenticated;

-- A dispute closed in the shop's favour, or never opened at all.
create or replace function public.dispute_is_open(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status is not null
     and p_status not in ('won', 'lost', 'warning_closed');
$$;

-- Refunds made outside the admin -----------------------------------------------

-- Reconcile an order against what Stripe says has been refunded on its
-- charge. p_amount_refunded_cents is the charge's cumulative amount_refunded
-- and is taken as the truth, so replaying this is harmless; p_refunds is the
-- charge's refund list, and any entry not already in the ledger is added as
-- a row the admin can show. Refunds the admin itself made are already in the
-- ledger under the same stripe_refund_id and are left alone.
--
-- Returns the number of ledger rows added (0 when there was nothing new).
create or replace function public.reconcile_order_refunds(
  p_payment_intent_id text,
  p_amount_refunded_cents integer,
  p_refunds jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_refund jsonb;
  v_added integer := 0;
  v_capped integer;
  v_amount integer;
  v_created timestamptz;
begin
  if p_payment_intent_id is null or trim(p_payment_intent_id) = '' then
    return 0;
  end if;

  select * into v_order
    from public.orders
   where stripe_payment_intent_id = p_payment_intent_id
   for update;

  if not found then
    -- A payment this shop never recorded as an order. Nothing to reconcile,
    -- and not an error worth failing the delivery over.
    return 0;
  end if;

  for v_refund in select * from jsonb_array_elements(coalesce(p_refunds, '[]'::jsonb))
  loop
    continue when coalesce(v_refund->>'id', '') = '';

    -- order_refunds insists on a positive amount, and a zero-amount refund
    -- is not something worth inventing a ledger row for.
    v_amount := case
      when coalesce(v_refund->>'amount', '') ~ '^[0-9]+$'
        then (v_refund->>'amount')::integer
      else 0
    end;
    continue when v_amount <= 0;

    -- Stripe sends `created` as a unix timestamp; anything else is ignored
    -- rather than allowed to raise inside a delivery Stripe is retrying.
    v_created := case
      when coalesce(v_refund->>'created', '') ~ '^[0-9]+$'
        then to_timestamp((v_refund->>'created')::bigint)
      else now()
    end;

    insert into public.order_refunds
      (order_id, amount_cents, currency, kind, items, reason, status,
       stripe_refund_id, completed_at)
    values
      (v_order.id,
       v_amount,
       upper(coalesce(nullif(trim(coalesce(v_refund->>'currency', '')), ''), v_order.currency)),
       'amount',
       '[]'::jsonb,
       nullif(trim(coalesce(v_refund->>'reason', '')), ''),
       'succeeded',
       v_refund->>'id',
       v_created)
    on conflict (stripe_refund_id) do nothing;

    if found then
      v_added := v_added + 1;
    end if;
  end loop;

  -- Stripe is the authority on the total. The cap keeps the
  -- orders_refunded_cents_within_total constraint satisfied even if a
  -- currency rounding difference ever made the two disagree.
  v_capped := least(greatest(coalesce(p_amount_refunded_cents, 0), 0), v_order.total_cents);

  update public.orders
     set refunded_cents = v_capped,
         status = case
           when v_capped >= total_cents and status not in ('disputed') then 'refunded'
           else status
         end
   where id = v_order.id;

  return v_added;
end;
$$;

-- Disputes -----------------------------------------------------------------------

-- Record a dispute, or update one already recorded. Every charge.dispute.*
-- event goes through here: which one it was does not matter, only the status
-- Stripe reports. Opening a dispute moves the order to 'disputed' and
-- remembers what it was; winning puts it back; losing leaves it 'disputed',
-- because the money is gone and the order should not look live again.
--
-- Returns the dispute row id, or null when the payment is not one of ours.
create or replace function public.record_order_dispute(
  p_payment_intent_id text,
  p_stripe_dispute_id text,
  p_amount_cents integer,
  p_currency text,
  p_reason text,
  p_status text,
  p_evidence_due_at timestamptz,
  p_opened_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_dispute public.order_disputes%rowtype;
  v_previous text;
begin
  if p_stripe_dispute_id is null or trim(p_stripe_dispute_id) = '' then
    return null;
  end if;

  select * into v_order
    from public.orders
   where stripe_payment_intent_id = p_payment_intent_id
   for update;

  if not found then
    return null;
  end if;

  select * into v_dispute
    from public.order_disputes
   where stripe_dispute_id = p_stripe_dispute_id;

  -- Only worth remembering the first time: on a later event the order is
  -- already 'disputed', and storing that would lose the real one.
  v_previous := coalesce(v_dispute.previous_order_status, v_order.status);
  if v_previous = 'disputed' then
    v_previous := 'paid';
  end if;

  insert into public.order_disputes
    (order_id, stripe_dispute_id, amount_cents, currency, reason, status,
     evidence_due_at, previous_order_status, opened_at, closed_at)
  values
    (v_order.id,
     p_stripe_dispute_id,
     greatest(coalesce(p_amount_cents, 0), 0),
     upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), v_order.currency)),
     nullif(trim(coalesce(p_reason, '')), ''),
     coalesce(nullif(trim(coalesce(p_status, '')), ''), 'needs_response'),
     p_evidence_due_at,
     v_previous,
     coalesce(p_opened_at, now()),
     case when public.dispute_is_open(p_status) then null else now() end)
  on conflict (stripe_dispute_id) do update
     set amount_cents = excluded.amount_cents,
         currency = excluded.currency,
         reason = coalesce(excluded.reason, order_disputes.reason),
         status = excluded.status,
         evidence_due_at = coalesce(excluded.evidence_due_at, order_disputes.evidence_due_at),
         -- Never overwritten: the first event is the one that knew.
         previous_order_status = order_disputes.previous_order_status,
         closed_at = case
           when public.dispute_is_open(excluded.status) then null
           else coalesce(order_disputes.closed_at, now())
         end
  returning * into v_dispute;

  if public.dispute_is_open(v_dispute.status) then
    update public.orders
       set status = 'disputed'
     where id = v_order.id
       and status <> 'disputed';
  elsif v_dispute.status = 'won' then
    -- Won: the money stays with the shop, so the order goes back to what it
    -- was. Only if nothing else has moved it on since.
    update public.orders
       set status = coalesce(v_dispute.previous_order_status, 'paid')
     where id = v_order.id
       and status = 'disputed';
  end if;
  -- 'lost' deliberately leaves the order 'disputed'.

  return v_dispute.id;
end;
$$;

-- Set once the owner has been emailed about a dispute, so a Stripe retry or
-- a later event on the same dispute does not tell them twice.
create or replace function public.mark_order_dispute_notified(p_dispute_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.order_disputes
     set notified_at = now()
   where id = p_dispute_id
     and notified_at is null;
end;
$$;

-- Webhook-only, like record_discount_redemption: these are reached with the
-- service-role key, which is not a shop owner and so cannot be guarded with
-- is_shop_owner(). Taking execute away from everyone else is what keeps them
-- out of the Data API.
revoke all on function public.reconcile_order_refunds(text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.record_order_dispute(text, text, integer, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_order_dispute_notified(uuid) from public, anon, authenticated;

-- An order being charged back must not also be refunded by hand: Stripe
-- usually refuses, and when it does not the shop pays twice. The rest of the
-- function is unchanged from 0003.
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

  if exists (
    select 1 from public.order_disputes
     where order_id = p_order_id
       and public.dispute_is_open(status)
  ) then
    raise exception 'Order % is being disputed and cannot be refunded', p_order_id
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

revoke all on function public.begin_order_refund(uuid, integer, text, jsonb, numeric, text) from public, anon;
grant execute on function public.begin_order_refund(uuid, integer, text, jsonb, numeric, text) to authenticated;

-- set_order_status checked which status was being set, but never which one
-- the order was already in, so a hand-made POST could move a refunded order
-- back to 'paid'. With 'disputed' that is worse than untidy: clearing it
-- would make a charged-back order refundable again and the shop would pay
-- twice. Both are states the money decided, so neither can be left by hand.
-- Otherwise unchanged from 0004.
create or replace function public.set_order_status(
  p_order_id uuid,
  p_status text,
  p_tracking_carrier text default null,
  p_tracking_number text default null,
  p_tracking_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can change an order status'
      using errcode = '42501';
  end if;

  if p_status not in ('pending', 'paid', 'fulfilled', 'cancelled') then
    raise exception 'Status % cannot be set by hand', p_status
      using errcode = '22023';
  end if;

  if p_tracking_url is not null and p_tracking_url !~* '^https?://' then
    raise exception 'Tracking link must start with http:// or https://'
      using errcode = '22023';
  end if;

  select status into v_current from public.orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found'
      using errcode = 'P0002';
  end if;

  if v_current in ('refunded', 'disputed') then
    raise exception 'Order % is % and its status cannot be changed by hand', p_order_id, v_current
      using errcode = '22023';
  end if;

  update public.orders
     set status = p_status,
         -- Tracking is only meaningful on a shipped order; saving it with
         -- another status would be a mistake, so it is left alone then.
         tracking_carrier = case when p_status = 'fulfilled'
           then nullif(trim(p_tracking_carrier), '') else tracking_carrier end,
         tracking_number = case when p_status = 'fulfilled'
           then nullif(trim(p_tracking_number), '') else tracking_number end,
         tracking_url = case when p_status = 'fulfilled'
           then nullif(trim(p_tracking_url), '') else tracking_url end,
         shipped_at = case when p_status = 'fulfilled'
           then coalesce(shipped_at, now()) else shipped_at end
   where id = p_order_id;
end;
$$;

revoke all on function public.set_order_status(uuid, text, text, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text, text, text, text) to authenticated;
