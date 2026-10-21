-- Two findings from a Supabase security advisor scan (2026-07-17):
--
-- 1. cart_items had an RLS policy with using(true)/with check(true) — "accessible
--    by anyone with the session ID". In practice this meant anyone with the public
--    anon key (embedded in every page's JS bundle) could call the PostgREST API
--    directly, bypassing the app entirely, to dump every guest's cart contents
--    store-wide or delete/tamper with any cart_items row with no filter needed.
--    All cart_items access in the app already goes through Next.js server actions
--    (never the browser client), so this locks the table to service-role only —
--    matching the same "no public access" pattern already used for mailing_list.
--    App code updated in the same change to use the admin client for cart_items
--    and to explicitly filter by cart_session_id on delete/update (defense in depth).
--
-- 2. The public-read policy on storage.objects for the product-images bucket
--    allowed anon `list()` calls to enumerate every file in the bucket. Public
--    buckets already serve individual objects via a public URL
--    (/storage/v1/object/public/...) without needing any RLS policy — the app
--    only ever calls getPublicUrl()/upload(), never list(), on this bucket — so
--    the SELECT policy is dropped without affecting existing functionality.

drop policy if exists "Cart items access" on public.cart_items;

create policy "No public access to cart_items"
  on public.cart_items for all
  using (false)
  with check (false);

drop policy if exists "Public read product-images" on storage.objects;
