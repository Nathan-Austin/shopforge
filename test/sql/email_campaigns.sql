-- email_campaigns and email_audiences: the owner's alone; the subscriber
-- sync columns and the 'edited' event exist. Run by test/check-schema.sh.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a4', 'owner4@shop.test'),
  ('00000000-0000-4000-8000-0000000000c4', 'customer4@shop.test')
on conflict do nothing;
update public.profiles set role = 'shop_owner' where id = '00000000-0000-4000-8000-0000000000a4';

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('request.jwt.claim.role', case when p_user is null then 'anon' else 'authenticated' end, false);
  if p_user is null then set role anon; else set role authenticated; end if;
end $$;

select pg_temp.act_as('00000000-0000-4000-8000-0000000000a4') \gset
insert into public.email_campaigns (id, name, document) values ('00000000-0000-4000-8000-00000000ca01', 'Spring', '{"version": 1, "blocks": []}');
insert into public.email_audiences (locale, audience_id) values ('de', 'aud_test');
update public.email_campaigns set status = 'scheduled', scheduled_at = now() + interval '1 day', locales = '{"de": {"broadcastId": "b1"}}' where id = '00000000-0000-4000-8000-00000000ca01';
do $$ begin
  begin
    insert into public.email_campaigns (name, document, status) values ('Bad', '{"version": 1}', 'queued');
    raise exception 'accepted an unknown status';
  exception when check_violation then null;
  end;
  begin
    insert into public.email_campaigns (name, document) values ('Bad', '{"blocks": []}');
    raise exception 'accepted a document without a version';
  exception when check_violation then null;
  end;
  begin
    insert into public.email_audiences (locale, audience_id) values ('DE', 'x');
    raise exception 'accepted an uppercase locale';
  exception when check_violation then null;
  end;
end $$;
reset role;

select pg_temp.act_as('00000000-0000-4000-8000-0000000000c4') \gset
do $$ begin
  if (select count(*) from public.email_campaigns) <> 0 then raise exception 'a customer can read campaigns'; end if;
  if (select count(*) from public.email_audiences) <> 0 then raise exception 'a customer can read audiences'; end if;
  begin
    insert into public.email_campaigns (name, document) values ('Mine', '{"version": 1}');
    raise exception 'a customer created a campaign';
  exception when insufficient_privilege then null;
  end;
  update public.email_campaigns set status = 'sent';
end $$;
reset role;
do $$ begin
  if (select status from public.email_campaigns where id = '00000000-0000-4000-8000-00000000ca01') <> 'scheduled' then raise exception 'a customer changed a campaign'; end if;
end $$;

-- Deleting a template leaves its campaigns, without the link.
insert into public.email_templates (id, name, document) values ('00000000-0000-4000-8000-00000000e0a4', 'T', '{"version": 1}');
update public.email_campaigns set template_id = '00000000-0000-4000-8000-00000000e0a4' where id = '00000000-0000-4000-8000-00000000ca01';
delete from public.email_templates where id = '00000000-0000-4000-8000-00000000e0a4';
do $$ begin
  if (select template_id from public.email_campaigns where id = '00000000-0000-4000-8000-00000000ca01') is not null then raise exception 'campaign lost or kept a dangling template'; end if;
end $$;

-- Subscriber sync columns and the edited event.
insert into public.email_subscribers (id, email, locale, source, consent_text, provider_contact_id, provider_locale, provider_synced_at)
values ('00000000-0000-4000-8000-00000000b0a4', 'sync@example.com', 'de', 'footer', 'x', 'c_1', 'de', now());
insert into public.email_subscriber_events (subscriber_id, event, detail) values ('00000000-0000-4000-8000-00000000b0a4', 'edited', 'first_name');
do $$ begin
  begin
    insert into public.email_subscriber_events (subscriber_id, event) values ('00000000-0000-4000-8000-00000000b0a4', 'synced');
    raise exception 'accepted an unknown event';
  exception when check_violation then null;
  end;
end $$;

-- A sync marks the row seen without counting as an edit; an edit makes it
-- due again. Separate statements, as in the app: each is its own
-- transaction, so now() moves between them.
insert into public.email_subscribers (id, email, locale, status, source, consent_text, confirmed_at)
values ('00000000-0000-4000-8000-00000000b0a5', 'due@example.com', 'en', 'subscribed', 'footer', 'x', now());
do $$ begin
  if not (select provider_sync_due from public.email_subscribers where id = '00000000-0000-4000-8000-00000000b0a5') then raise exception 'a new subscriber is not due'; end if;
end $$;
create temp table sync_check as select updated_at as before_sync from public.email_subscribers where id = '00000000-0000-4000-8000-00000000b0a5';
select pg_sleep(0.02) \gset
update public.email_subscribers set provider_contact_id = 'c_2', provider_locale = 'en', provider_synced_at = now() where id = '00000000-0000-4000-8000-00000000b0a5';
do $$ begin
  if (select provider_sync_due from public.email_subscribers where id = '00000000-0000-4000-8000-00000000b0a5') then raise exception 'still due after a sync'; end if;
  if (select updated_at from public.email_subscribers where id = '00000000-0000-4000-8000-00000000b0a5') <> (select before_sync from sync_check) then raise exception 'a sync moved updated_at'; end if;
end $$;
select pg_sleep(0.02) \gset
update public.email_subscribers set first_name = 'Dee' where id = '00000000-0000-4000-8000-00000000b0a5';
insert into public.email_subscribers (id, email, locale, source, consent_text) values ('00000000-0000-4000-8000-00000000b0a6', 'pend@example.com', 'en', 'footer', 'x');
do $$ begin
  if not (select provider_sync_due from public.email_subscribers where id = '00000000-0000-4000-8000-00000000b0a5') then raise exception 'an edit did not make the row due'; end if;
  if (select provider_sync_due from public.email_subscribers where id = '00000000-0000-4000-8000-00000000b0a6') then raise exception 'a pending subscriber is due'; end if;
end $$;
delete from public.email_subscribers where id in ('00000000-0000-4000-8000-00000000b0a5', '00000000-0000-4000-8000-00000000b0a6');
drop table sync_check;

delete from public.email_campaigns where id = '00000000-0000-4000-8000-00000000ca01';
delete from public.email_audiences where locale = 'de';
delete from public.email_subscribers where id = '00000000-0000-4000-8000-00000000b0a4';

\echo email_campaigns: ok
