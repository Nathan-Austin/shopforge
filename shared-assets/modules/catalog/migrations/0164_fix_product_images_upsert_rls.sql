-- storage.objects for the product-images bucket has never had an UPDATE policy
-- (only INSERT and DELETE, from 0004_storage_policies.sql). All image uploads in
-- the app call supabase.storage.upload(..., { upsert: true }), which Postgres
-- executes as INSERT ... ON CONFLICT DO UPDATE. Without an UPDATE policy, that
-- fails RLS on every upload attempt -- even for a brand-new filename with no
-- actual conflict -- because Postgres checks the UPDATE policy for the
-- ON CONFLICT DO UPDATE clause regardless of whether a conflict occurs.
--
-- This broke image uploads in the marketing email builder (EmailBuilder.tsx)
-- and was latent in the product image uploader (ImageUploader.tsx) too, both
-- of which use upsert: true.

create policy "Authenticated update product-images"
  on storage.objects for update
  using (bucket_id = 'product-images' AND (auth.role() = 'authenticated'))
  with check (bucket_id = 'product-images' AND (auth.role() = 'authenticated'));
