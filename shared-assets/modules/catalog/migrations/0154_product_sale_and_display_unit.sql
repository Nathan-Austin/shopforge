alter table public.products
  add column if not exists on_sale boolean not null default false,
  add column if not exists sale_price_cents integer,
  add column if not exists display_unit text not null default 'ml';

alter table public.products
  drop constraint if exists products_display_unit_check;

alter table public.products
  add constraint products_display_unit_check check (display_unit in ('ml', 'g'));

alter table public.product_variants
  add column if not exists sale_price_cents integer;
