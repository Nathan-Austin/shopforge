-- 0006_email_templates: campaign templates built in /admin/email (2026-11-05).
--
-- Owner-only, with backstop checks on the stored document. Needs 0001_init.

-- Email templates --------------------------------------------------------------

-- Campaign templates built in the admin (/admin/email). The document is the
-- block layout the designer edits; the app validates it in full (Zod,
-- src/lib/email/campaigns/schema.ts) on every save, and these checks are
-- only the backstop for a write that skipped the app: an object, version 1,
-- and small enough that no single row can bloat the table.
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  -- 'campaign' today; transactional layouts (receipt, shipping, refund)
  -- join in a later phase.
  kind text not null default 'campaign' check (kind in ('campaign')),
  document jsonb not null check (
    jsonb_typeof(document) = 'object'
    -- coalesce: a missing version is null, which a check would let through
    and coalesce(document->>'version' = '1', false)
    and pg_column_size(document) <= 262144
  ),
  -- Claimed before a test send, so a double click sends one email.
  last_test_sent_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_templates_updated on public.email_templates(updated_at desc);

-- updated_at is "last edited": it moves when the name or the document
-- changes, not when a test send is claimed, and a client cannot set it.
create or replace function public.touch_email_template_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.name is distinct from old.name
     or new.kind is distinct from old.kind
     or new.document is distinct from old.document then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_email_templates_updated on public.email_templates;
create trigger trg_email_templates_updated
before update on public.email_templates
for each row
execute function public.touch_email_template_updated_at();

alter table public.email_templates enable row level security;

-- The owner's alone: customers and visitors never see a template, not even
-- one about to be sent to them.
drop policy if exists "Email templates manage" on public.email_templates;
create policy "Email templates manage"
  on public.email_templates
  for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

revoke all on public.email_templates from anon, authenticated;
grant select, insert, update, delete on public.email_templates to authenticated;

