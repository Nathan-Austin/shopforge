-- Two campaign providers (0011_mailchimp): a shop may hold a key for each,
-- exactly one is active, and audiences are kept per provider so switching
-- does not hand Mailchimp a Resend audience id.
-- Run by test/check-schema.sh.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ab', 'owner11@shop.test')
on conflict do nothing;
update public.profiles set role = 'shop_owner' where id = '00000000-0000-4000-8000-0000000000ab';

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('request.jwt.claim.role', case when p_user is null then 'anon' else 'authenticated' end, false);
  if p_user is null then set role anon; else set role authenticated; end if;
end $$;

-- The first key stored becomes the active one -------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000000ab') \gset
do $$ begin
  perform public.set_email_provider_key('resend', 're_test_abcdefgh1111');
end $$;
reset role;

do $$ begin
  if (select provider from public.email_provider_keys where is_active) <> 'resend'
    then raise exception 'the first key stored did not become active'; end if;
end $$;

-- A second provider's key is stored without stealing the choice.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000ab') \gset
do $$ begin
  perform public.set_email_provider_key('mailchimp', 'abcdefghijklmnop1234567890ab-us21');
end $$;
reset role;

do $$ begin
  if (select count(*) from public.email_provider_keys) <> 2
    then raise exception 'the second key did not land'; end if;
  if (select provider from public.email_provider_keys where is_active) <> 'resend'
    then raise exception 'storing a second key stole the active flag'; end if;
  if (select last_four from public.email_provider_keys where provider = 'mailchimp') <> 'us21'
    then raise exception 'the mailchimp hint is wrong'; end if;
  -- Each key is its own secret, and each is readable by the server only.
  if public.get_email_provider_key('mailchimp') <> 'abcdefghijklmnop1234567890ab-us21'
    then raise exception 'the mailchimp key did not round-trip'; end if;
  if public.get_email_provider_key('resend') <> 're_test_abcdefgh1111'
    then raise exception 'storing mailchimp disturbed the resend key'; end if;
end $$;

-- Switching ------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000000ab') \gset
do $$ begin
  perform public.set_active_email_provider('mailchimp');
end $$;
reset role;

do $$ begin
  if (select provider from public.email_provider_keys where is_active) <> 'mailchimp'
    then raise exception 'the provider did not switch'; end if;
  if (select count(*) from public.email_provider_keys where is_active) <> 1
    then raise exception 'more than one provider is active'; end if;
end $$;

-- A provider with no key cannot be chosen, and nor can a made-up one.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000ab') \gset
do $$ begin
  perform public.clear_email_provider_key('resend');
  begin
    perform public.set_active_email_provider('resend');
    raise exception 'a provider with no key could be chosen';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_active_email_provider('brevo');
    raise exception 'an unknown provider could be chosen';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- A customer cannot switch provider.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000cb', 'customer11@shop.test') on conflict do nothing;
select pg_temp.act_as('00000000-0000-4000-8000-0000000000cb') \gset
do $$ begin
  begin
    perform public.set_active_email_provider('mailchimp');
    raise exception 'a customer could switch provider';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Clearing the active key hands the flag on ----------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000000ab') \gset
do $$ begin
  perform public.set_email_provider_key('resend', 're_test_second_round_22');
end $$;
reset role;

do $$ begin
  -- mailchimp is still the active one; resend came back as a spare.
  if (select provider from public.email_provider_keys where is_active) <> 'mailchimp'
    then raise exception 'restoring a key stole the active flag'; end if;
end $$;

select pg_temp.act_as('00000000-0000-4000-8000-0000000000ab') \gset
do $$ begin
  perform public.clear_email_provider_key('mailchimp');
end $$;
reset role;

do $$ begin
  if (select provider from public.email_provider_keys where is_active) <> 'resend'
    then raise exception 'clearing the active key left the shop with none chosen'; end if;
end $$;

-- Audiences are per provider ---------------------------------------------------

insert into public.email_audiences (locale, provider, audience_id) values
  ('de', 'resend', 'aud_de'),
  ('de', 'mailchimp', 'list_1:lang-de');

do $$ begin
  if (select count(*) from public.email_audiences where locale = 'de') <> 2
    then raise exception 'one locale cannot hold an audience per provider'; end if;
  if (select audience_id from public.email_audiences where locale = 'de' and provider = 'mailchimp') <> 'list_1:lang-de'
    then raise exception 'the mailchimp audience id is wrong'; end if;
end $$;

-- The same locale and provider twice is still refused.
do $$ begin
  begin
    insert into public.email_audiences (locale, provider, audience_id) values ('de', 'resend', 'aud_other');
    raise exception 'a duplicate locale and provider was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.email_audiences (locale, provider, audience_id) values ('de', 'brevo', 'x');
    raise exception 'an unknown audience provider was accepted';
  exception when check_violation then null;
  end;
end $$;

-- Campaigns may name either provider, and nothing else.
do $$ begin
  begin
    insert into public.email_campaigns (name, document, provider) values ('MC', '{"version": 1}', 'mailchimp');
  exception when others then raise exception 'a mailchimp campaign was refused: %', sqlerrm;
  end;
  begin
    insert into public.email_campaigns (name, document, provider) values ('Bad', '{"version": 1}', 'brevo');
    raise exception 'an unknown campaign provider was accepted';
  exception when check_violation then null;
  end;
end $$;

delete from public.email_campaigns where name = 'MC';
delete from public.email_audiences where locale = 'de';
select pg_temp.act_as('00000000-0000-4000-8000-0000000000ab') \gset
do $$ begin perform public.clear_email_provider_key('resend'); end $$;
reset role;

\echo email_provider_choice: ok
