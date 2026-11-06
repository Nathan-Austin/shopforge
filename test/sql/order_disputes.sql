-- Disputes and refunds reconciled from Stripe (0009_disputes):
--   * reconcile_order_refunds is idempotent and takes Stripe's cumulative
--     amount_refunded as the truth, without double-counting a refund the
--     admin already recorded;
--   * a dispute moves the order to 'disputed', winning restores what it was,
--     losing leaves it disputed;
--   * an order with an open dispute cannot be refunded by hand;
--   * only the shop owner can read order_disputes.
-- Run by test/check-schema.sh.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a9', 'owner9@shop.test'),
  ('00000000-0000-4000-8000-0000000000c9', 'customer9@shop.test')
on conflict do nothing;
update public.profiles set role = 'shop_owner' where id = '00000000-0000-4000-8000-0000000000a9';

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('request.jwt.claim.role', case when p_user is null then 'anon' else 'authenticated' end, false);
  if p_user is null then set role anon; else set role authenticated; end if;
end $$;

-- Two paid orders, written the way the webhook writes them (service role).
insert into public.orders
  (id, email, status, currency, subtotal_cents, shipping_cents, total_cents,
   stripe_session_id, stripe_payment_intent_id)
values
  ('00000000-0000-4000-8000-00000000d001', 'customer9@shop.test', 'paid', 'EUR',
   9000, 1000, 10000, 'cs_test_dispute_1', 'pi_test_dispute_1'),
  ('00000000-0000-4000-8000-00000000d002', 'customer9@shop.test', 'fulfilled', 'EUR',
   4000, 0, 4000, 'cs_test_dispute_2', 'pi_test_dispute_2');

-- Refunds made outside the admin ------------------------------------------------

-- A 2500 refund from the Stripe dashboard.
do $$
declare v_added integer;
begin
  v_added := public.reconcile_order_refunds(
    'pi_test_dispute_1', 2500,
    '[{"id": "re_test_1", "amount": 2500, "currency": "eur", "reason": "requested_by_customer", "created": 1762000000}]'::jsonb);
  if v_added <> 1 then raise exception 'expected one ledger row, added %', v_added; end if;
  if (select refunded_cents from public.orders where id = '00000000-0000-4000-8000-00000000d001') <> 2500
    then raise exception 'refunded_cents did not follow Stripe'; end if;
  if (select status from public.orders where id = '00000000-0000-4000-8000-00000000d001') <> 'paid'
    then raise exception 'a partial refund changed the status'; end if;
end $$;

-- The same delivery again, and a Stripe retry of it: neither may double-count.
do $$
declare v_added integer;
begin
  v_added := public.reconcile_order_refunds(
    'pi_test_dispute_1', 2500,
    '[{"id": "re_test_1", "amount": 2500, "currency": "eur", "created": 1762000000}]'::jsonb);
  if v_added <> 0 then raise exception 'a replay added % ledger rows', v_added; end if;
  if (select count(*) from public.order_refunds where order_id = '00000000-0000-4000-8000-00000000d001') <> 1
    then raise exception 'a replay duplicated the ledger row'; end if;
  if (select refunded_cents from public.orders where id = '00000000-0000-4000-8000-00000000d001') <> 2500
    then raise exception 'a replay moved refunded_cents'; end if;
end $$;

-- A second refund takes it to the full total: the order becomes 'refunded'.
do $$ begin
  perform public.reconcile_order_refunds(
    'pi_test_dispute_1', 10000,
    '[{"id": "re_test_1", "amount": 2500, "currency": "eur", "created": 1762000000},
      {"id": "re_test_2", "amount": 7500, "currency": "eur", "created": 1762000100}]'::jsonb);
  if (select refunded_cents from public.orders where id = '00000000-0000-4000-8000-00000000d001') <> 10000
    then raise exception 'refunded_cents did not reach the total'; end if;
  if (select status from public.orders where id = '00000000-0000-4000-8000-00000000d001') <> 'refunded'
    then raise exception 'a fully refunded order is not marked refunded'; end if;
  if (select count(*) from public.order_refunds where order_id = '00000000-0000-4000-8000-00000000d001') <> 2
    then raise exception 'the second refund was not recorded'; end if;
end $$;

-- Rubbish in the refund list is skipped, not raised: Stripe is retrying.
do $$
declare v_added integer;
begin
  v_added := public.reconcile_order_refunds(
    'pi_test_dispute_1', 10000,
    '[{"id": "", "amount": 10}, {"id": "re_zero", "amount": 0}, {"id": "re_junk", "amount": "lots"}]'::jsonb);
  if v_added <> 0 then raise exception 'a malformed refund list added rows'; end if;
end $$;

-- A payment that is not ours is ignored rather than failing the delivery.
do $$ begin
  if public.reconcile_order_refunds('pi_not_ours', 500, '[]'::jsonb) <> 0
    then raise exception 'an unknown payment intent was not ignored'; end if;
end $$;

-- Disputes ------------------------------------------------------------------------

-- Opened on the fulfilled order: status becomes 'disputed', the old one is kept.
do $$
declare v_id uuid;
begin
  v_id := public.record_order_dispute(
    'pi_test_dispute_2', 'dp_test_1', 4000, 'eur', 'fraudulent',
    'needs_response', now() + interval '7 days', now());
  if v_id is null then raise exception 'the dispute was not recorded'; end if;
  if (select status from public.orders where id = '00000000-0000-4000-8000-00000000d002') <> 'disputed'
    then raise exception 'the order was not marked disputed'; end if;
  if (select previous_order_status from public.order_disputes where stripe_dispute_id = 'dp_test_1') <> 'fulfilled'
    then raise exception 'the previous status was not remembered'; end if;
end $$;

-- An order being disputed cannot be refunded by hand.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000a9') \gset
do $$ begin
  begin
    perform public.begin_order_refund('00000000-0000-4000-8000-00000000d002', 100, 'amount', '[]'::jsonb, null, null);
    raise exception 'a disputed order was refundable';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- A later event on the same dispute updates it in place and does not lose
-- the remembered status.
do $$ begin
  perform public.record_order_dispute(
    'pi_test_dispute_2', 'dp_test_1', 4000, 'eur', null,
    'under_review', now() + interval '7 days', now());
  if (select count(*) from public.order_disputes where stripe_dispute_id = 'dp_test_1') <> 1
    then raise exception 'the dispute was recorded twice'; end if;
  if (select previous_order_status from public.order_disputes where stripe_dispute_id = 'dp_test_1') <> 'fulfilled'
    then raise exception 'an update overwrote the previous status'; end if;
  if (select reason from public.order_disputes where stripe_dispute_id = 'dp_test_1') <> 'fraudulent'
    then raise exception 'an update dropped the reason'; end if;
  if (select closed_at from public.order_disputes where stripe_dispute_id = 'dp_test_1') is not null
    then raise exception 'an open dispute has a closed_at'; end if;
end $$;

-- Won: the order goes back to what it was, and the dispute is closed.
do $$ begin
  perform public.record_order_dispute(
    'pi_test_dispute_2', 'dp_test_1', 4000, 'eur', null, 'won', null, now());
  if (select status from public.orders where id = '00000000-0000-4000-8000-00000000d002') <> 'fulfilled'
    then raise exception 'winning did not restore the order status'; end if;
  if (select closed_at from public.order_disputes where stripe_dispute_id = 'dp_test_1') is null
    then raise exception 'a won dispute has no closed_at'; end if;
end $$;

-- Lost: the order stays 'disputed', because the money is gone.
do $$ begin
  perform public.record_order_dispute(
    'pi_test_dispute_1', 'dp_test_2', 10000, 'eur', 'product_not_received',
    'needs_response', null, now());
  perform public.record_order_dispute(
    'pi_test_dispute_1', 'dp_test_2', 10000, 'eur', null, 'lost', null, now());
  if (select status from public.orders where id = '00000000-0000-4000-8000-00000000d001') <> 'disputed'
    then raise exception 'a lost dispute did not leave the order disputed'; end if;
end $$;

-- The owner is told once.
do $$
declare v_id uuid;
begin
  select id into v_id from public.order_disputes where stripe_dispute_id = 'dp_test_2';
  perform public.mark_order_dispute_notified(v_id);
  if (select notified_at from public.order_disputes where id = v_id) is null
    then raise exception 'the dispute was not marked notified'; end if;
  perform public.mark_order_dispute_notified(v_id);
  if (select count(*) from public.order_disputes where id = v_id and notified_at is not null) <> 1
    then raise exception 'marking twice went wrong'; end if;
end $$;

-- Neither a disputed nor a refunded order can be moved by hand: the UI
-- disables the control, but this is what a hand-made POST meets.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000a9') \gset
do $$ begin
  begin
    perform public.set_order_status('00000000-0000-4000-8000-00000000d001', 'paid');
    raise exception 'a disputed order could be moved by hand';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- But an ordinary order still moves, tracking and all.
do $$ begin
  update public.orders set status = 'paid' where id = '00000000-0000-4000-8000-00000000d002';
end $$;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000a9') \gset
do $$ begin
  perform public.set_order_status('00000000-0000-4000-8000-00000000d002', 'fulfilled', 'DHL', '123', 'https://track.test/123');
  if (select status from public.orders where id = '00000000-0000-4000-8000-00000000d002') <> 'fulfilled'
    then raise exception 'an ordinary status change stopped working'; end if;
  if (select tracking_number from public.orders where id = '00000000-0000-4000-8000-00000000d002') <> '123'
    then raise exception 'tracking details were lost'; end if;
  begin
    perform public.set_order_status('00000000-0000-4000-8000-0000000000ff', 'paid');
    raise exception 'an unknown order did not raise';
  exception when no_data_found then null;
  end;
end $$;
reset role;

-- A dispute on a payment we never saw is ignored.
do $$ begin
  if public.record_order_dispute('pi_not_ours', 'dp_x', 100, 'eur', null, 'needs_response', null, now()) is not null
    then raise exception 'a dispute on an unknown payment was recorded'; end if;
end $$;

-- Who can read the ledger ----------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000000a9') \gset
do $$ begin
  if (select count(*) from public.order_disputes) <> 2 then raise exception 'the owner cannot read disputes'; end if;
end $$;
reset role;

select pg_temp.act_as('00000000-0000-4000-8000-0000000000c9') \gset
do $$ begin
  if (select count(*) from public.order_disputes) <> 0 then raise exception 'a customer can read disputes'; end if;
end $$;
reset role;

-- A visitor has no grant on the table at all, so this is a privilege error
-- rather than an empty result: RLS never even gets a say.
select pg_temp.act_as(null) \gset
do $$ begin
  begin
    perform count(*) from public.order_disputes;
    raise exception 'a visitor can read disputes';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

delete from public.order_disputes where stripe_dispute_id in ('dp_test_1', 'dp_test_2');
delete from public.orders where id in
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000d002');

\echo order_disputes: ok
