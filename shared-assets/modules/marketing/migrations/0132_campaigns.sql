create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  subject       text not null,
  preview_text  text,
  blocks        jsonb not null default '[]',
  status        text not null default 'draft' check (status in ('draft', 'sent', 'failed')),
  sent_at       timestamptz,
  recipient_count integer,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

alter table public.campaigns enable row level security;

create policy "No public access to campaigns"
  on public.campaigns for all using (false);
