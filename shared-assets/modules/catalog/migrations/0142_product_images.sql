create table if not exists product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  url text not null,
  position integer not null default 0,
  created_at timestamptz default now()
);

create index on product_images(product_id, position);

-- Seed from existing image_url column
insert into product_images (product_id, url, position)
select id, image_url, 0
from products
where image_url is not null;

-- RLS
alter table product_images enable row level security;

create policy "Public can view product images"
  on product_images for select using (true);

create policy "Authenticated users can manage product images"
  on product_images for all using (auth.role() = 'authenticated');
