-- Replace "always enter a stock number" with an in-stock/out-of-stock
-- checkbox, plus an optional low-stock quantity that only needs setting
-- when a product/variant has a genuinely limited quantity left.
--
-- `stock` is renamed to `low_stock_quantity` (now nullable — null means
-- "not tracking a count, just in/out of stock") and a new `in_stock`
-- boolean becomes the source of truth for purchasability. Existing stock
-- numbers are preserved as the starting low_stock_quantity so the Stripe
-- webhook keeps counting down exactly as before; `in_stock` is backfilled
-- from whether that number was > 0.

alter table public.products
  rename column stock to low_stock_quantity;
alter table public.products
  alter column low_stock_quantity drop default;
alter table public.products
  add column in_stock boolean not null default true;

update public.products
  set in_stock = coalesce(low_stock_quantity, 0) > 0;

alter table public.product_variants
  rename column stock to low_stock_quantity;
alter table public.product_variants
  alter column low_stock_quantity drop not null;
alter table public.product_variants
  alter column low_stock_quantity drop default;
alter table public.product_variants
  add column in_stock boolean not null default true;

update public.product_variants
  set in_stock = coalesce(low_stock_quantity, 0) > 0;

-- reduce_stock(): only decrements low_stock_quantity when the product is
-- actually tracking one (not null). When a tracked count hits 0, auto-flip
-- in_stock to false so the storefront reflects it without an admin visit.
-- The OUT parameters change shape (stock -> low_stock_quantity, +in_stock),
-- which `create or replace` can't do to an existing function, hence the drop.
drop function if exists public.reduce_stock(text, integer);
create function public.reduce_stock(p_name text, p_quantity integer)
returns table(id uuid, low_stock_quantity integer, low_stock_threshold integer, in_stock boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return query
  update public.products
  set
    low_stock_quantity = case
      when products.low_stock_quantity is null then null
      else greatest(products.low_stock_quantity - p_quantity, 0)
    end,
    in_stock = case
      when products.low_stock_quantity is not null
        and products.low_stock_quantity - p_quantity <= 0
      then false
      else products.in_stock
    end
  where name = p_name
  returning products.id, products.low_stock_quantity, products.low_stock_threshold, products.in_stock;
end;
$$;

revoke execute on function public.reduce_stock(text, integer) from public;
grant execute on function public.reduce_stock(text, integer) to service_role;
