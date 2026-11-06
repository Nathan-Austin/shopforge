-- 0004_shipping: tracking details and the checkout locale (2026-11-04).
--
-- orders.locale, carrier/tracking/shipped_at and the shipping-notified
-- marker. Replaces set_order_status(uuid, text) with the five-argument
-- version that takes tracking details. Needs 0002_orders.

-- Shipping and notifications ---------------------------------------------------

-- The locale the customer checked out in, so emails sent later (shipping,
-- refunds) can be in their language rather than the owner's.
alter table public.orders
  add column if not exists locale text;

-- Tracking details the owner enters when marking an order shipped, when the
-- parcel left, and when the customer was told. shipping_notified_at is the
-- guard against emailing twice: flipping the status back and forth does not
-- email again once it is set.
alter table public.orders
  add column if not exists tracking_carrier text,
  add column if not exists tracking_number text,
  add column if not exists tracking_url text,
  add column if not exists shipped_at timestamptz,
  add column if not exists shipping_notified_at timestamptz;

-- The status function gains optional tracking details. The old two-argument
-- signature is dropped so there is one function; callers that pass two
-- arguments still work through the defaults. 'refunded' is no longer
-- settable by hand: the refund flow sets it once the money has moved.
drop function if exists public.set_order_status(uuid, text);
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

  if not found then
    raise exception 'Order not found'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_order_status(uuid, text, text, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text, text, text, text) to authenticated;

-- Recorded once the shipping email is away.
create or replace function public.mark_order_shipping_notified(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_owner() then
    raise exception 'Only the shop owner can change an order'
      using errcode = '42501';
  end if;

  update public.orders
     set shipping_notified_at = now()
   where id = p_order_id;
end;
$$;

revoke all on function public.mark_order_shipping_notified(uuid) from public, anon;
grant execute on function public.mark_order_shipping_notified(uuid) to authenticated;

