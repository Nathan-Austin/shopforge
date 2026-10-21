-- Returns true if the current authenticated user has bought the given product
-- in an order that was paid (including orders since shipped or partly refunded).
-- Status is compared as text because 'partially_refunded' is added to the
-- order_status enum by a later migration (0166).
create or replace function public.has_purchased_product(p_product_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_id = p_product_id
      and o.user_id = auth.uid()
      and o.status::text in ('paid', 'shipped', 'partially_refunded')
  );
$$;
