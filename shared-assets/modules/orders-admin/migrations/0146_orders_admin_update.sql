-- Allow shop owner to update order status
drop policy if exists "Orders update shop owner" on public.orders;
create policy "Orders update shop owner" on public.orders
  for update using (public.is_shop_owner())
  with check (public.is_shop_owner());
