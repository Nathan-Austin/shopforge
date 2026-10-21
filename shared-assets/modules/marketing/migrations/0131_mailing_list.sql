-- Mailing list: source of truth for all email marketing subscribers
-- Replaces Mailchimp as the subscriber store. Resend is used only for sending.

create type public.mailing_list_status as enum ('subscribed', 'unsubscribed', 'cleaned');
create type public.mailing_list_source as enum ('mailchimp_import', 'order', 'newsletter_signup', 'manual');

create table public.mailing_list (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  first_name  text,
  last_name   text,
  status      public.mailing_list_status not null default 'subscribed',
  source      public.mailing_list_source not null default 'manual',
  subscribed_at timestamptz,
  unsubscribed_at timestamptz,
  profile_id  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint mailing_list_email_unique unique (email)
);

-- Keep updated_at in sync
create or replace function public.set_mailing_list_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger mailing_list_updated_at
  before update on public.mailing_list
  for each row execute function public.set_mailing_list_updated_at();

-- Indexes
create index mailing_list_email_idx on public.mailing_list (lower(email));
create index mailing_list_status_idx on public.mailing_list (status);
create index mailing_list_profile_idx on public.mailing_list (profile_id);

-- RLS: no public access, server-side only via service role
alter table public.mailing_list enable row level security;

create policy "No public access to mailing list"
  on public.mailing_list for all using (false);
