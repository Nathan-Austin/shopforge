-- 0162 dropped the SELECT policy on storage.objects for product-images entirely,
-- to stop anon `list()` enumeration. That also broke every upload: Supabase
-- Storage's upload endpoint does `INSERT ... RETURNING ...`, and Postgres RLS
-- requires a SELECT policy to let RETURNING see the row that was just
-- inserted -- with no SELECT policy at all, the INSERT itself succeeds but the
-- RETURNING check fails, aborting the whole upload with
-- "new row violates row-level security policy for table \"objects\"".
-- Verified directly: the same insert succeeds without RETURNING and fails with it.
--
-- Fix: restore SELECT, but scoped to authenticated users only (not anon), so
-- upload's RETURNING check works while the original anon-enumeration finding
-- stays fixed. Public single-object downloads are unaffected either way, since
-- those go through the public /object/public/ URL and never touch RLS.

create policy "Authenticated read product-images"
  on storage.objects for select
  using (bucket_id = 'product-images' AND (auth.role() = 'authenticated'));
