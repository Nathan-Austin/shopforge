-- The campaign provider key (0010_email_provider_keys): write-only.
--
--   * the owner can set it and see only that it is set, when, and its last
--     four characters;
--   * the owner cannot read it back — get_email_provider_key is the server's
--     alone, and the vault schema is out of reach from the Data API;
--   * a customer or a visitor sees nothing at all;
--   * setting it again replaces it rather than piling up secrets.
--
-- The Vault here is test/supabase-stub.sql's plaintext stand-in: this checks
-- who may do what, not the encryption, which is Vault's own.
-- Run by test/check-schema.sh.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000aa', 'owner10@shop.test'),
  ('00000000-0000-4000-8000-0000000000ca', 'customer10@shop.test')
on conflict do nothing;
update public.profiles set role = 'shop_owner' where id = '00000000-0000-4000-8000-0000000000aa';

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('request.jwt.claim.role', case when p_user is null then 'anon' else 'authenticated' end, false);
  if p_user is null then set role anon; else set role authenticated; end if;
end $$;

-- The stand-in Vault has to be in place, or the rest proves nothing.
do $$ begin
  if not public.vault_is_available() then
    raise exception 'the Vault stand-in is missing: test/supabase-stub.sql did not load';
  end if;
end $$;

-- The owner sets a key ------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000000aa') \gset
do $$ begin
  perform public.set_email_provider_key('resend', 're_test_abcdefghijkl1234');
end $$;
reset role;

do $$ begin
  if (select count(*) from public.email_provider_keys where provider = 'resend') <> 1
    then raise exception 'the key metadata was not written'; end if;
  if (select last_four from public.email_provider_keys where provider = 'resend') <> '1234'
    then raise exception 'the last four characters are wrong'; end if;
  if (select set_by from public.email_provider_keys where provider = 'resend')
     <> '00000000-0000-4000-8000-0000000000aa'
    then raise exception 'the key was not attributed to the owner'; end if;
  if (select verified_at from public.email_provider_keys where provider = 'resend') is null
    then raise exception 'a stored key is not marked verified'; end if;
  -- The secret itself must not be anywhere in public.
  if (select count(*) from public.email_provider_keys where secret_name like '%abcdefghijkl%') <> 0
    then raise exception 'the key leaked into the metadata table'; end if;
end $$;

-- The server, and only the server, can read it back -------------------------

do $$ begin
  if public.get_email_provider_key('resend') <> 're_test_abcdefghijkl1234'
    then raise exception 'the server cannot read the key back'; end if;
  if public.get_email_provider_key('mailchimp') is not null
    then raise exception 'an unset provider returned a key'; end if;
end $$;

-- The owner may NOT: that is what makes the key write-only.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000aa') \gset
do $$ begin
  begin
    perform public.get_email_provider_key('resend');
    raise exception 'the shop owner could read the key back';
  exception when insufficient_privilege then null;
  end;
  -- Nor by going around the function to Vault itself.
  begin
    perform count(*) from vault.decrypted_secrets;
    raise exception 'the shop owner could read vault.decrypted_secrets';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The owner sees the metadata, and only the metadata.
do $$ begin
  if (select count(*) from public.email_provider_keys) <> 1
    then raise exception 'the owner cannot see that a key is set'; end if;
end $$;

-- And cannot write the table directly, only through the function.
do $$ begin
  begin
    update public.email_provider_keys set last_four = '9999' where provider = 'resend';
    raise exception 'the owner could edit the key metadata directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.email_provider_keys (provider, secret_name) values ('resend', 'x');
    raise exception 'the owner could insert key metadata directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Replacing a key swaps it, rather than piling secrets up ---------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000000aa') \gset
do $$ begin
  perform public.set_email_provider_key('resend', 're_live_zyxwvutsrqpo9876');
end $$;
reset role;

do $$ begin
  if (select count(*) from vault.secrets where name = 'email_provider_key_resend') <> 1
    then raise exception 'replacing the key left more than one secret'; end if;
  if public.get_email_provider_key('resend') <> 're_live_zyxwvutsrqpo9876'
    then raise exception 'the replacement key was not stored'; end if;
  if (select last_four from public.email_provider_keys where provider = 'resend') <> '9876'
    then raise exception 'the last four characters were not updated'; end if;
  if (select count(*) from public.email_provider_keys) <> 1
    then raise exception 'replacing the key added a second row'; end if;
end $$;

-- What is refused ------------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000000aa') \gset
do $$ begin
  begin
    perform public.set_email_provider_key('resend', 'short');
    raise exception 'a key too short to be real was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_email_provider_key('mailchimp', 'abcdefghijklmnop');
    raise exception 'an unknown provider was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- A customer cannot set one, nor see that one exists.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000ca') \gset
do $$ begin
  begin
    perform public.set_email_provider_key('resend', 're_customer_attempt_123');
    raise exception 'a customer could set the provider key';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.email_provider_keys) <> 0
    then raise exception 'a customer can see the provider key metadata'; end if;
end $$;
reset role;

-- A visitor has no grant on the table at all.
select pg_temp.act_as(null) \gset
do $$ begin
  begin
    perform count(*) from public.email_provider_keys;
    raise exception 'a visitor can read the provider key metadata';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Clearing it ------------------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000000aa') \gset
do $$ begin
  perform public.clear_email_provider_key('resend');
end $$;
reset role;

do $$ begin
  if (select count(*) from public.email_provider_keys where provider = 'resend') <> 0
    then raise exception 'clearing left the metadata behind'; end if;
  if (select count(*) from vault.secrets where name = 'email_provider_key_resend') <> 0
    then raise exception 'clearing left the secret in Vault'; end if;
  if public.get_email_provider_key('resend') is not null
    then raise exception 'the key is still readable after clearing'; end if;
end $$;

-- Clearing something that was never set is not an error.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000aa') \gset
do $$ begin
  perform public.clear_email_provider_key('resend');
end $$;
reset role;

\echo email_provider_keys: ok
