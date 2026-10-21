alter table public.categories
  add column if not exists featured_product_id uuid references public.products(id) on delete set null;
