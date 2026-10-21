-- Create reviews table
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  rating integer not null check (rating >= 1 and rating <= 5),
  title text,
  content text not null,
  customer_name text not null,
  is_verified boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS (Row Level Security)
alter table public.reviews enable row level security;

-- Everyone can read reviews
drop policy if exists "Reviews are viewable by everyone" on public.reviews;
create policy "Reviews are viewable by everyone"
  on public.reviews for select
  using (true);

-- Authenticated users can submit reviews
drop policy if exists "Authenticated users can create reviews" on public.reviews;
create policy "Authenticated users can create reviews"
  on public.reviews for insert
  with check (auth.role() = 'authenticated');

-- Shop owners can manage (update/delete) any review
drop policy if exists "Shop owners can manage reviews" on public.reviews;
create policy "Shop owners can manage reviews"
  on public.reviews for all
  using (public.is_shop_owner());

-- Indexes for performance
create index if not exists idx_reviews_product on public.reviews(product_id);
create index if not exists idx_reviews_rating on public.reviews(rating);

-- Trigger for updated_at timestamp
drop trigger if exists trg_reviews_updated on public.reviews;
create trigger trg_reviews_updated
before update on public.reviews
for each row
execute function public.touch_updated_at();
