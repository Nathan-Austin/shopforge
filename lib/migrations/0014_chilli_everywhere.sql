-- 0014_chilli_everywhere: every shop gets the chilli tables (2026-11-20).
--
-- Step 6 of docs/single-codebase-plan.md turns the store mode into a
-- setting rather than a choice of files, and Q6 answered how: every shop
-- carries the chilli tables, empty and unused in a generic one, in
-- exchange for a single schema. The columns-always-exist principle the
-- product fields already follow (0001 has every column; the setting says
-- which the admin uses) now covers heat too, so switching a shop to
-- chilli mode never needs a migration.
--
-- In a chilli shop this is a no-op: the tables, columns and policies are
-- already there from its 0001_init, and the view below is recreated with
-- the definition it already has.
--
-- The view is dropped and recreated rather than replaced because the two
-- heat columns sit in the middle of its column list, and
-- `create or replace view` can only append. That is the same thing
-- 0001_init does, grant included; nothing depends on this view
-- (product_sales reads order_items).
--
-- Needs 0001_init.

create table if not exists public.chilli_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  heat_level integer,
  description text,
  created_at timestamptz default now()
);

create index if not exists idx_chilli_types_slug on public.chilli_types(slug);

alter table public.products add column if not exists heat_level integer;
alter table public.products add column if not exists scoville_shu integer;

create table if not exists public.products_chilli_types (
  product_id uuid references public.products(id) on delete cascade,
  chilli_type_id uuid references public.chilli_types(id) on delete cascade,
  primary key (product_id, chilli_type_id)
);

alter table public.chilli_types enable row level security;
alter table public.products_chilli_types enable row level security;

-- Readable by everyone, written by the owner: the same pair the catalogue
-- tables already use.
drop policy if exists "Chilli types select all" on public.chilli_types;
create policy "Chilli types select all"
  on public.chilli_types
  for select
  using (true);

drop policy if exists "Chilli types manage" on public.chilli_types;
create policy "Chilli types manage"
  on public.chilli_types
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

drop policy if exists "Product chilli select" on public.products_chilli_types;
create policy "Product chilli select"
  on public.products_chilli_types
  for select
  using (true);

drop policy if exists "Product chilli manage" on public.products_chilli_types;
create policy "Product chilli manage"
  on public.products_chilli_types
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

-- The storefront view, now with heat in every shop (null where nothing
-- sets it). Identical to the chilli 0001_init definition, so the two
-- modes end up with one view.
drop view if exists public.products_public;
create view public.products_public as
select
  p.id,
  p.name,
  p.slug,
  p.sku,
  p.barcode,
  p.headline,
  p.description,
  p.details,
  p.image_url,
  p.gallery_urls,
  p.video_url,
  p.price_cents,
  p.compare_at_price_cents,
  p.currency,
  p.tax_rate_percent,
  p.category_id,
  p.brand_id,
  p.stock,
  p.track_inventory,
  p.allow_backorder,
  p.max_order_quantity,
  p.size_options,
  p.color_options,
  p.net_content,
  p.net_content_unit,
  p.weight_grams,
  p.dimensions_mm,
  p.ingredients,
  p.allergens,
  p.nutrition_info,
  p.dietary_flags,
  p.storage_instructions,
  p.best_before_text,
  p.tags,
  p.country_of_origin,
  p.meta_title,
  p.meta_description,
  p.heat_level,
  p.scoville_shu,
  p.is_featured,
  p.created_at,
  p.updated_at,
  c.name as category_name,
  c.slug as category_slug,
  b.name as brand_name,
  b.slug as brand_slug
from public.products p
left join public.categories c on c.id = p.category_id
left join public.brands b on b.id = p.brand_id
where p.is_active is not false
  and p.archived_at is null;

grant select on public.products_public to anon, authenticated;
