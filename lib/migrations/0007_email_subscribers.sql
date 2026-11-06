-- 0007_email_subscribers: the newsletter list (2026-11-05).
--
-- Double opt-in subscribers with their consent record, and the
-- append-only event history behind it. Needs 0001_init.

-- Email subscribers --------------------------------------------------------------

-- The newsletter list. Double opt-in: a sign-up is 'pending' until the
-- person clicks the button behind the link in the confirmation email, and
-- only 'subscribed' rows ever get a campaign. Each row is also the
-- consent record: what they were shown, where, when they asked, when they
-- confirmed and when they left. Sign-up, confirmation and unsubscribing
-- run on the server with the service-role key (visitors have no session);
-- through the Data API the list is the owner's alone.
create table if not exists public.email_subscribers (
  id uuid primary key default gen_random_uuid(),
  -- Stored lowercase and trimmed, so one person is one row.
  email text not null unique check (
    email = lower(trim(email))
    and char_length(email) between 3 and 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  first_name text check (first_name is null or char_length(first_name) <= 100),
  -- The language their emails go out in: a shop locale code.
  locale text not null check (locale ~ '^[a-z]{2,3}(-[a-z]{2})?$'),
  status text not null default 'pending' check (status in ('pending', 'subscribed', 'unsubscribed')),
  source text not null check (source in ('footer', 'checkout', 'import', 'admin')),
  -- The wording they agreed to, as shown, in their language.
  consent_text text not null check (char_length(consent_text) between 1 and 1000),
  consented_at timestamptz not null default now(),
  confirmation_sent_at timestamptz,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Subscribed means confirmed (or imported with the owner's word for it);
  -- unsubscribed always says when.
  check (status <> 'subscribed' or confirmed_at is not null or source = 'import'),
  check (status <> 'unsubscribed' or unsubscribed_at is not null)
);

create index if not exists idx_email_subscribers_status on public.email_subscribers(status);

drop trigger if exists trg_email_subscribers_updated on public.email_subscribers;
create trigger trg_email_subscribers_updated
before update on public.email_subscribers
for each row
execute function public.touch_updated_at();

-- What happened, in order: the proof behind a subscription. Written by
-- the server alongside each change; deleting a subscriber (a request to
-- be forgotten) deletes their history with them.
create table if not exists public.email_subscriber_events (
  id bigint generated always as identity primary key,
  subscriber_id uuid not null references public.email_subscribers(id) on delete cascade,
  event text not null check (event in ('requested', 'confirmation_sent', 'confirmed', 'unsubscribed', 'imported', 'resubscribe_requested')),
  source text,
  detail text check (detail is null or char_length(detail) <= 500),
  at timestamptz not null default now()
);

create index if not exists idx_email_subscriber_events_subscriber on public.email_subscriber_events(subscriber_id, at);

alter table public.email_subscribers enable row level security;
alter table public.email_subscriber_events enable row level security;

drop policy if exists "Email subscribers manage" on public.email_subscribers;
create policy "Email subscribers manage"
  on public.email_subscribers
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

-- The history is read-only through the API, even for the owner.
drop policy if exists "Email subscriber events read" on public.email_subscriber_events;
create policy "Email subscriber events read"
  on public.email_subscriber_events
  for select
  using (public.is_shop_owner());

revoke all on public.email_subscribers from anon, authenticated;
grant select, insert, update, delete on public.email_subscribers to authenticated;
revoke all on public.email_subscriber_events from anon, authenticated;
grant select on public.email_subscriber_events to authenticated;

