-- Security hardening from a Supabase advisor scan (2026-07-17), part 2.
-- Every SECURITY DEFINER function is directly callable via
-- /rest/v1/rpc/<name> by whichever roles hold EXECUTE — by default that's
-- anon + authenticated (Postgres grants EXECUTE to PUBLIC unless revoked).
-- Several of these had no internal authorization check.

-- 1. reduce_stock(name, qty) decrements a product's stock with zero purchase
--    verification. Pre-fix, any anonymous visitor could call it directly and
--    zero out inventory storewide. Only ever called by the Stripe webhook via
--    the service-role client (src/app/api/webhooks/stripe/route.ts:242).
--
--    increment_voucher_redemption(promo_code_id) increments a voucher's
--    redemption counter with no purchase check — could be used to exhaust a
--    limited-use discount code. Only ever called by the same webhook (line 141).
--
--    Also fixes a pre-existing, independent correctness bug in reduce_stock:
--    the bare `stock` reference inside `greatest(stock - p_quantity, 0)`
--    collided with the RETURNS TABLE's `stock` OUT parameter, so plpgsql
--    raised "column reference \"stock\" is ambiguous" on every call. The
--    Stripe webhook only logs that error and continues (doesn't throw), so
--    every completed order has been silently failing to decrement stock.
--    Fixed by fully qualifying the read as `products.stock`.
--
--    Lock both to service_role only. IMPORTANT: revoking EXECUTE from just
--    anon/authenticated is not sufficient — Postgres grants EXECUTE to the
--    PUBLIC pseudo-role by default at function creation, and anon/authenticated
--    are implicitly members of PUBLIC, so that grant must be revoked explicitly
--    too or the anon/authenticated-specific revoke is a no-op.
create or replace function public.reduce_stock(p_name text, p_quantity integer)
returns table(id uuid, stock integer, low_stock_threshold integer)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return query
  update public.products
  set stock = greatest(products.stock - p_quantity, 0)
  where name = p_name
  returning products.id, products.stock, products.low_stock_threshold;
end;
$$;

create or replace function public.increment_voucher_redemption(p_promo_code_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.vouchers
  set redemptions_count = redemptions_count + 1
  where stripe_promo_code_id = p_promo_code_id;
end;
$$;

revoke execute on function public.reduce_stock(text, integer) from public;
revoke execute on function public.increment_voucher_redemption(text) from public;
grant execute on function public.reduce_stock(text, integer) to service_role;
grant execute on function public.increment_voucher_redemption(text) to service_role;

-- 2. handle_new_user()/set_product_owner() are trigger-only functions.
--    Postgres already refuses to execute trigger functions outside trigger
--    context (and trigger firing itself doesn't go through the EXECUTE ACL
--    check at all, so this revoke can't break the signup/product-insert
--    triggers) — this is hygiene, removing an unnecessary/confusing public
--    RPC surface. Same PUBLIC-vs-named-role caveat as above applies.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.set_product_owner() from public;

-- 3. search_path hardening for the remaining functions the advisor flagged
--    (trigger functions, no privilege escalation angle, but costs nothing).
create or replace function public.set_mailing_list_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 4. GraphQL API is unused by the app (no graphql client/query anywhere in
--    src/) and is a live, unauthenticated query surface alongside the REST
--    API with no code path exercising it. NOTE: `graphql_public`'s grants
--    are owned by Supabase's managed `supabase_admin` role — `revoke usage
--    on schema graphql_public from anon, authenticated` was attempted here
--    but silently has no effect under the `postgres` migration role (no
--    error, no change to pg_namespace.nspacl). Disabling it requires the
--    Supabase Dashboard: Database > Extensions > disable pg_graphql (or
--    Project Settings > API > Data API > GraphQL toggle, if present).

-- 5. webhook_logs is written only by the Stripe webhook via the service-role
--    client and was never meant to be publicly readable.
create policy "No public access to webhook_logs"
  on public.webhook_logs for all
  using (false) with check (false);
