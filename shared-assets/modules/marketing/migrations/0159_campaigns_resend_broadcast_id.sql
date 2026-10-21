-- Track the Resend broadcast id behind each campaign, now that sending goes
-- through the Resend Broadcasts API instead of a manual per-subscriber loop.
alter table public.campaigns
  add column resend_broadcast_id text;
