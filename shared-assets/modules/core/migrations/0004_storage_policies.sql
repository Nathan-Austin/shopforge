-- Storage Policies
-- Note: 'product-images' bucket must be created in the Supabase Dashboard.
-- These policies apply once the bucket exists.
-- RLS should be enabled via the Dashboard Storage settings.

create policy "Public read product-images" 
on storage.objects for select 
using (bucket_id = 'product-images');

create policy "Authenticated upload product-images" 
on storage.objects for insert 
with check (bucket_id = 'product-images' AND (auth.role() = 'authenticated'));

create policy "Authenticated delete product-images" 
on storage.objects for delete 
using (bucket_id = 'product-images' AND (auth.role() = 'authenticated'));
