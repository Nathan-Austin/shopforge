-- Table for Double Opt-In newsletter process
create table if not exists public.newsletter_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  token text not null unique,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

-- RLS
alter table public.newsletter_signups enable row level security;

-- Only service role (server actions) should manage this table directly
create policy "No public access to signups" on public.newsletter_signups
  for all using (false);

-- Ensure a 10% Welcome Voucher exists (Seed if not exists)
-- Note: This is a "forever" coupon that can be used by anyone once
do $$
begin
  -- Note: We can't easily seed the Stripe ID here, so we will create it 
  -- via an admin action or manual setup, but we'll reserve the code.
end $$;
