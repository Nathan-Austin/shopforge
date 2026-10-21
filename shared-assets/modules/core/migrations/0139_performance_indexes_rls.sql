-- Missing FK indexes flagged by performance advisor
create index if not exists idx_addresses_user_id on public.addresses(user_id);
create index if not exists idx_cart_items_product_id on public.cart_items(product_id);
create index if not exists idx_cart_items_variant_id on public.cart_items(variant_id);
create index if not exists idx_order_items_product_id on public.order_items(product_id);
create index if not exists idx_products_chilli_types_chilli_type_id on public.products_chilli_types(chilli_type_id);
create index if not exists idx_reviews_user_id on public.reviews(user_id);

-- Fix auth_rls_initplan: use (select auth.uid()) so Postgres evaluates it once per
-- query instead of once per row. Significant on large tables.

-- addresses
drop policy if exists "Addresses access" on public.addresses;
create policy "Addresses access"
  on public.addresses for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- profiles
drop policy if exists "Profiles select own" on public.profiles;
create policy "Profiles select own"
  on public.profiles for select
  using ((select auth.uid()) = id);

drop policy if exists "Profiles update own" on public.profiles;
create policy "Profiles update own"
  on public.profiles for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- orders
drop policy if exists "Orders select own" on public.orders;
create policy "Orders select own"
  on public.orders for select
  using ((select auth.uid()) = user_id or (select is_shop_owner()));

-- order_items
drop policy if exists "Order items select own" on public.order_items;
create policy "Order items select own"
  on public.order_items for select
  using (
    exists (
      select 1 from orders
      where orders.id = order_items.order_id
        and (orders.user_id = (select auth.uid()) or (select is_shop_owner()))
    )
  );

-- notifications: consolidate duplicate policies and fix initplan
drop policy if exists "Notifications select own" on public.notifications;
drop policy if exists "Users can see their own notifications" on public.notifications;
drop policy if exists "Notifications update own" on public.notifications;
drop policy if exists "Users can update their own notifications" on public.notifications;

create policy "Notifications select own"
  on public.notifications for select
  using ((select auth.uid()) = user_id or (select is_shop_owner()));

create policy "Notifications update own"
  on public.notifications for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- shop_events
drop policy if exists "Allow admin all access on shop_events" on public.shop_events;
create policy "Allow admin all access on shop_events"
  on public.shop_events for all
  using (
    exists (
      select 1 from profiles
      where profiles.id = (select auth.uid()) and profiles.role = 'shop_owner'
    )
  );

-- video_reviews
drop policy if exists "Allow admin all access on video_reviews" on public.video_reviews;
create policy "Allow admin all access on video_reviews"
  on public.video_reviews for all
  using (
    exists (
      select 1 from profiles
      where profiles.id = (select auth.uid()) and profiles.role = 'shop_owner'
    )
  );
