-- 0008_email_campaigns: campaigns and provider audiences (2026-11-05).
--
-- email_campaigns, email_audiences, and the provider sync columns and
-- provider_sync_due flag added to email_subscribers. Needs 0007.

-- Email campaigns ------------------------------------------------------------------

-- A campaign is a template sent, or scheduled to be sent, to the confirmed
-- subscribers of each language, through the campaign provider (Resend
-- Broadcasts). The document is a snapshot taken when the campaign is
-- created, so editing the template afterwards never changes what went
-- out. `locales` holds one entry per language: the provider's broadcast
-- id, how many people it went to and its status.
create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  template_id uuid references public.email_templates(id) on delete set null,
  document jsonb not null check (jsonb_typeof(document) = 'object' and coalesce(document->>'version' = '1', false)),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  provider text not null default 'resend' check (provider in ('resend')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  locales jsonb not null default '{}' check (jsonb_typeof(locales) = 'object'),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  error text check (error is null or char_length(error) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_campaigns_created on public.email_campaigns(created_at desc);

drop trigger if exists trg_email_campaigns_updated on public.email_campaigns;
create trigger trg_email_campaigns_updated
before update on public.email_campaigns
for each row
execute function public.touch_updated_at();

alter table public.email_campaigns enable row level security;

drop policy if exists "Email campaigns manage" on public.email_campaigns;
create policy "Email campaigns manage"
  on public.email_campaigns
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

revoke all on public.email_campaigns from anon, authenticated;
grant select, insert, update, delete on public.email_campaigns to authenticated;

-- The provider's audience for each language (one Resend audience per
-- locale), created the first time the list is synced.
create table if not exists public.email_audiences (
  locale text primary key check (locale ~ '^[a-z]{2,3}(-[a-z]{2})?$'),
  provider text not null default 'resend' check (provider in ('resend')),
  audience_id text not null check (char_length(audience_id) between 1 and 200),
  -- When the provider's own unsubscribes were last read back.
  pulled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.email_audiences enable row level security;

drop policy if exists "Email audiences manage" on public.email_audiences;
create policy "Email audiences manage"
  on public.email_audiences
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

revoke all on public.email_audiences from anon, authenticated;
grant select, insert, update, delete on public.email_audiences to authenticated;

-- Where each subscriber stands with the provider: the contact id, which
-- language's audience it is in, and when it was last pushed. A row whose
-- updated_at is newer than provider_synced_at is pushed on the next sync.
alter table public.email_subscribers
  add column if not exists provider_contact_id text,
  add column if not exists provider_locale text,
  add column if not exists provider_synced_at timestamptz;

-- 'edited' (the owner changed a name or language) joins the history.
alter table public.email_subscriber_events drop constraint if exists email_subscriber_events_event_check;
alter table public.email_subscriber_events add constraint email_subscriber_events_event_check
  check (event in ('requested', 'confirmation_sent', 'confirmed', 'unsubscribed', 'imported', 'resubscribe_requested', 'edited'));

-- A sync only writes the provider_* columns; that is not an edit, so it
-- must not move updated_at (which would make the row due again at once).
create or replace function public.touch_email_subscriber_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.email is distinct from old.email
     or new.first_name is distinct from old.first_name
     or new.locale is distinct from old.locale
     or new.status is distinct from old.status
     or new.source is distinct from old.source
     or new.consent_text is distinct from old.consent_text then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_email_subscribers_updated on public.email_subscribers;
create trigger trg_email_subscribers_updated
before update on public.email_subscribers
for each row
execute function public.touch_email_subscriber_updated_at();

-- Due for a push: confirmed or unsubscribed people (never the pending)
-- that the provider has not seen since their last change.
alter table public.email_subscribers
  add column if not exists provider_sync_due boolean
  generated always as (status <> 'pending' and (provider_synced_at is null or updated_at > provider_synced_at)) stored;

create index if not exists idx_email_subscribers_sync_due on public.email_subscribers(locale) where provider_sync_due;
