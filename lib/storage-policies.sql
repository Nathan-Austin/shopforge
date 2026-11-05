-- Storage policies for the product-images bucket.
-- The bucket itself is created in the Supabase dashboard (public); these
-- policies apply once it exists. Safe to run again: each policy is
-- dropped first, including the ones earlier shops were generated with.
--
-- Anyone may read (product photos and email images are public), but only
-- the shop owner may upload, replace or delete. Earlier versions let any
-- signed-in user, customers included, upload and delete.

drop policy if exists "Public read product-images" on storage.objects;
create policy "Public read product-images"
on storage.objects for select
using (bucket_id = 'product-images');

-- Replaced by the owner-only policies below.
drop policy if exists "Authenticated upload product-images" on storage.objects;
drop policy if exists "Authenticated delete product-images" on storage.objects;

drop policy if exists "Owner upload product-images" on storage.objects;
create policy "Owner upload product-images"
on storage.objects for insert
with check (bucket_id = 'product-images' and public.is_shop_owner());

-- Uploads with upsert overwrite an existing file, which is an update.
drop policy if exists "Owner update product-images" on storage.objects;
create policy "Owner update product-images"
on storage.objects for update
using (bucket_id = 'product-images' and public.is_shop_owner())
with check (bucket_id = 'product-images' and public.is_shop_owner());

drop policy if exists "Owner delete product-images" on storage.objects;
create policy "Owner delete product-images"
on storage.objects for delete
using (bucket_id = 'product-images' and public.is_shop_owner());
