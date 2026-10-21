-- Future-proof Data API access grants.
-- From October 30 2026, Supabase requires explicit GRANTs for new tables.
-- Applying them now to all existing public-schema tables so the change has no impact.
-- All tables have RLS enabled, so these grants do not bypass row-level security.

DO $$
DECLARE
  tables text[] := ARRAY[
    'addresses',
    'brands',
    'campaigns',
    'cart_items',
    'categories',
    'chilli_types',
    'mailing_list',
    'newsletter_signups',
    'notifications',
    'order_items',
    'orders',
    'product_categories',
    'product_images',
    'product_variants',
    'products',
    'products_chilli_types',
    'profiles',
    'reviews',
    'shop_events',
    'video_reviews',
    'vouchers',
    'webhook_logs'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip tables from modules that aren't installed.
    CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;
    EXECUTE format('GRANT ALL ON public.%I TO postgres, service_role', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
  END LOOP;
END $$;
