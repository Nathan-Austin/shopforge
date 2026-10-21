-- Fix security advisor warnings: recreate views with security_invoker
-- so they respect the querying user's RLS policies, not the view creator's.

create or replace view public.product_ratings
  with (security_invoker = true)
as
select
  product_id,
  round(avg(rating)::numeric, 1) as avg_rating,
  count(*)::integer               as review_count
from public.reviews
where product_id is not null
group by product_id;
