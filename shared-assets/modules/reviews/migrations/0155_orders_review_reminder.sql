alter table public.orders
  add column if not exists review_reminder_sent_at timestamptz;

create index if not exists idx_orders_review_reminder_pending
  on public.orders (created_at)
  where review_reminder_sent_at is null;
