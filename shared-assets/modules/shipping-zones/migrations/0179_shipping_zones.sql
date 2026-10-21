-- Admin-editable shipping zones: each zone has a carrier, the countries it
-- covers and weight-based price brackets. Checkout reads these tables; edit
-- them in /admin/shipping.

create table public.shipping_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  carrier text,
  is_default boolean not null default false,
  free_shipping_threshold_cents integer,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shipping_zone_countries (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.shipping_zones(id) on delete cascade,
  -- ISO 3166-1 alpha-3, matching the codes already used by the checkout
  -- form's country <select> (src/app/[locale]/checkout/components/CheckoutForm.tsx).
  country_code text not null unique,
  created_at timestamptz not null default now()
);

create table public.shipping_zone_brackets (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.shipping_zones(id) on delete cascade,
  -- null = no upper bound (the catch-all last bracket for the zone)
  max_weight_kg numeric,
  price_cents integer not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.shipping_zones enable row level security;
alter table public.shipping_zone_countries enable row level security;
alter table public.shipping_zone_brackets enable row level security;

create policy "Shipping zones select shop owner" on public.shipping_zones
  for select using (public.is_shop_owner());
create policy "Shipping zones manage shop owner" on public.shipping_zones
  for all using (public.is_shop_owner()) with check (public.is_shop_owner());

create policy "Shipping zone countries select shop owner" on public.shipping_zone_countries
  for select using (public.is_shop_owner());
create policy "Shipping zone countries manage shop owner" on public.shipping_zone_countries
  for all using (public.is_shop_owner()) with check (public.is_shop_owner());

create policy "Shipping zone brackets select shop owner" on public.shipping_zone_brackets
  for select using (public.is_shop_owner());
create policy "Shipping zone brackets manage shop owner" on public.shipping_zone_brackets
  for all using (public.is_shop_owner()) with check (public.is_shop_owner());

create trigger trg_shipping_zones_updated
before update on public.shipping_zones
for each row
execute function public.touch_updated_at();

create index idx_shipping_zone_countries_zone on public.shipping_zone_countries(zone_id);
create index idx_shipping_zone_brackets_zone on public.shipping_zone_brackets(zone_id);

-- ==================== SEED: one editable default zone ====================
-- A worldwide fallback so checkout works out of the box. Replace the
-- placeholder rate and add country-specific zones in /admin/shipping.

do $$
declare
  v_default uuid;
begin
  insert into public.shipping_zones (name, carrier, is_default, sort_order)
    values ('Worldwide', null, true, 1) returning id into v_default;
  -- No explicit countries: the default zone covers every country not claimed
  -- by another zone.
  insert into public.shipping_zone_brackets (zone_id, max_weight_kg, price_cents, sort_order)
    values (v_default, null, 995, 1);
end $$;
