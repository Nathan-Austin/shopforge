alter table public.orders
  add column if not exists review_discount_sent_at timestamptz;

alter table public.one_time_discount_codes
  drop constraint if exists one_time_discount_codes_source_check;
alter table public.one_time_discount_codes
  add constraint one_time_discount_codes_source_check
  check (source in ('review_reminder', 'newsletter_welcome', 'review_reward'));
