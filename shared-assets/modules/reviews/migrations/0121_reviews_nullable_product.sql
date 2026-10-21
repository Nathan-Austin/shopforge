-- Allow store-level reviews (product_id = NULL)
-- These are reviews about the shop/service rather than a specific product
alter table public.reviews alter column product_id drop not null;
