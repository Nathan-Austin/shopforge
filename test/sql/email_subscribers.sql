-- email_subscribers and its event history: the owner's alone through the
-- API, the consent record holds together, and deleting a subscriber
-- deletes their history. Run by test/check-schema.sh.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a3', 'owner3@shop.test'),
  ('00000000-0000-4000-8000-0000000000c3', 'customer3@shop.test')
on conflict do nothing;
update public.profiles set role = 'shop_owner' where id = '00000000-0000-4000-8000-0000000000a3';

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('request.jwt.claim.role', case when p_user is null then 'anon' else 'authenticated' end, false);
  if p_user is null then set role anon; else set role authenticated; end if;
end $$;

-- What the server writes (as the service role in the app; as postgres here).
insert into public.email_subscribers (id, email, first_name, locale, status, source, consent_text)
values ('00000000-0000-4000-8000-00000000b001', 'sam@example.com', 'Sam', 'de-at', 'pending', 'footer', 'Send me news and offers.');
insert into public.email_subscriber_events (subscriber_id, event, source) values ('00000000-0000-4000-8000-00000000b001', 'requested', 'footer');

-- The record's own rules.
do $$
declare
  bad text[] := array[
    $q$insert into public.email_subscribers (email, locale, source, consent_text) values ('Sam@Example.com', 'en', 'footer', 'x')$q$,
    $q$insert into public.email_subscribers (email, locale, source, consent_text) values ('not-an-email', 'en', 'footer', 'x')$q$,
    $q$insert into public.email_subscribers (email, locale, source, consent_text) values ('a@b.co', 'EN', 'footer', 'x')$q$,
    $q$insert into public.email_subscribers (email, locale, source, consent_text) values ('a@b.co', 'en', 'popup', 'x')$q$,
    $q$insert into public.email_subscribers (email, locale, source, consent_text) values ('a@b.co', 'en', 'footer', '')$q$,
    $q$insert into public.email_subscribers (email, locale, status, source, consent_text) values ('a@b.co', 'en', 'subscribed', 'footer', 'x')$q$,
    $q$insert into public.email_subscribers (email, locale, status, source, consent_text) values ('a@b.co', 'en', 'unsubscribed', 'footer', 'x')$q$,
    $q$insert into public.email_subscriber_events (subscriber_id, event) values ('00000000-0000-4000-8000-00000000b001', 'clicked')$q$
  ];
  statement text;
begin
  foreach statement in array bad loop
    begin
      execute statement;
      raise exception 'accepted: %', statement;
    exception when check_violation then null;
    end;
  end loop;
  begin
    insert into public.email_subscribers (email, locale, source, consent_text) values ('sam@example.com', 'en', 'checkout', 'x');
    raise exception 'accepted a second row for the same address';
  exception when unique_violation then null;
  end;
end $$;

-- Confirmed or imported may be subscribed.
insert into public.email_subscribers (email, locale, status, source, consent_text) values ('imported@example.com', 'en', 'subscribed', 'import', 'Agreed on the old list.');
update public.email_subscribers set status = 'subscribed', confirmed_at = now() where id = '00000000-0000-4000-8000-00000000b001';

-- The owner reads both tables and manages subscribers, but cannot rewrite history.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000a3') \gset
do $$ begin
  if (select count(*) from public.email_subscribers) <> 2 then raise exception 'owner cannot list subscribers'; end if;
  if (select count(*) from public.email_subscriber_events) <> 1 then raise exception 'owner cannot read the history'; end if;
  begin
    insert into public.email_subscriber_events (subscriber_id, event) values ('00000000-0000-4000-8000-00000000b001', 'confirmed');
    raise exception 'the owner wrote to the history';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.email_subscriber_events;
    raise exception 'the owner deleted history';
  exception when insufficient_privilege then null;
  end;
end $$;
update public.email_subscribers set first_name = 'Samuel' where email = 'sam@example.com';
reset role;

-- A customer and a visitor see nothing and change nothing.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000c3') \gset
do $$ begin
  if (select count(*) from public.email_subscribers) <> 0 then raise exception 'a customer can read the list'; end if;
  if (select count(*) from public.email_subscriber_events) <> 0 then raise exception 'a customer can read the history'; end if;
  begin
    insert into public.email_subscribers (email, locale, source, consent_text) values ('spam@example.com', 'en', 'footer', 'x');
    raise exception 'a customer added a subscriber';
  exception when insufficient_privilege then null;
  end;
  update public.email_subscribers set status = 'unsubscribed', unsubscribed_at = now();
end $$;
reset role;
select pg_temp.act_as(null) \gset
do $$ begin
  begin
    perform 1 from public.email_subscribers;
    raise exception 'anon can read the list';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if (select status from public.email_subscribers where email = 'sam@example.com') <> 'subscribed' then raise exception 'a customer unsubscribed someone'; end if;
  if (select first_name from public.email_subscribers where email = 'sam@example.com') <> 'Samuel' then raise exception 'the owner could not edit'; end if;
end $$;

-- Erasure takes the history with it.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000a3') \gset
delete from public.email_subscribers where email in ('sam@example.com', 'imported@example.com');
reset role;
do $$ begin
  if exists (select 1 from public.email_subscriber_events where subscriber_id = '00000000-0000-4000-8000-00000000b001') then
    raise exception 'history survived the subscriber';
  end if;
end $$;

\echo email_subscribers: ok
