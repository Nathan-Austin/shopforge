-- Security fixes for product images and reviews, follow-up to 0188.
--
-- 1. product_images (0142): "Authenticated users can manage product images"
--    let ANY signed-in customer insert/update/delete gallery rows. All admin
--    writes (createProduct/updateProduct via ensureShopOwner) use the
--    cookie-bound client as a shop owner, so is_shop_owner() is enough.
--
-- 2. storage.objects, product-images bucket (0004, 0164, 0165): upload /
--    update / delete / read were all gated on auth.role() = 'authenticated'.
--    Restrict to shop owners. SELECT must stay for owners: uploads do
--    INSERT ... RETURNING (and ImageUploader uses upsert), which needs a
--    SELECT policy (see 0165). Public downloads go through
--    /object/public/... and never touch RLS, so storefront images are
--    unaffected.
--
-- 3. reviews (0015): "Authenticated users can create reviews" only checked
--    the caller was signed in, so a customer could insert is_verified = true
--    and any user_id. submitReview.ts always inserts user_id = the caller and
--    is_verified = false; enforce exactly that. customer_name stays free
--    text -- the review form lets people choose their display name. Owners
--    keep full control via "Shop owners can manage reviews".

-- 1. product_images ----------------------------------------------------------

drop policy if exists "Authenticated users can manage product images" on public.product_images;
drop policy if exists "Shop owners can manage product images" on public.product_images;
create policy "Shop owners can manage product images"
  on public.product_images for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

-- 2. storage: product-images bucket ------------------------------------------

drop policy if exists "Authenticated upload product-images" on storage.objects;
drop policy if exists "Authenticated update product-images" on storage.objects;
drop policy if exists "Authenticated delete product-images" on storage.objects;
drop policy if exists "Authenticated read product-images" on storage.objects;
drop policy if exists "Shop owners upload product-images" on storage.objects;
drop policy if exists "Shop owners update product-images" on storage.objects;
drop policy if exists "Shop owners delete product-images" on storage.objects;
drop policy if exists "Shop owners read product-images" on storage.objects;

create policy "Shop owners upload product-images"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and public.is_shop_owner());

create policy "Shop owners update product-images"
  on storage.objects for update
  using (bucket_id = 'product-images' and public.is_shop_owner())
  with check (bucket_id = 'product-images' and public.is_shop_owner());

create policy "Shop owners delete product-images"
  on storage.objects for delete
  using (bucket_id = 'product-images' and public.is_shop_owner());

create policy "Shop owners read product-images"
  on storage.objects for select
  using (bucket_id = 'product-images' and public.is_shop_owner());

-- 3. reviews -----------------------------------------------------------------

drop policy if exists "Authenticated users can create reviews" on public.reviews;
create policy "Authenticated users can create reviews"
  on public.reviews for insert
  with check (
    (select auth.uid()) = user_id
    and is_verified = false
  );
