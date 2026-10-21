-- Product variants table (for size/weight options with different prices)
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  label text not null,
  price_cents integer not null,
  weight_grams integer,
  stock integer not null default 0,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_variants_product on public.product_variants(product_id);

drop trigger if exists trg_product_variants_updated on public.product_variants;
create trigger trg_product_variants_updated
before update on public.product_variants
for each row execute function public.touch_updated_at();

alter table public.product_variants enable row level security;

drop policy if exists "Variants select all" on public.product_variants;
create policy "Variants select all"
  on public.product_variants for select using (true);

drop policy if exists "Variants manage" on public.product_variants;
create policy "Variants manage"
  on public.product_variants for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

-- Add variant_id to cart_items
alter table public.cart_items
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null;
