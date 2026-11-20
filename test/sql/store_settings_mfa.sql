-- store_settings (0013): an account with a verified second factor must
-- present it to write a setting; one with no factor writes as before, and
-- reading a setting is untouched either way.
-- Run by test/check-schema.sh.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a3', 'owner13@shop.test')
on conflict do nothing;
update public.profiles set role = 'shop_owner' where id = '00000000-0000-4000-8000-0000000000a3';

-- Acts as the user at the given assurance level, the way PostgREST would.
create or replace function pg_temp.act_as_aal(p_user uuid, p_aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated', 'aal', p_aal)::text,
    false
  );
  set role authenticated;
end $$;

-- With no factor enrolled, a password-only session writes as it always did --------

select pg_temp.act_as_aal('00000000-0000-4000-8000-0000000000a3', 'aal1') \gset
insert into public.store_settings (key, value)
  values ('auth', '{"customerSignIn": "password", "adminMfa": "required"}')
  on conflict (key) do update set value = excluded.value;
reset role;

do $$ begin
  if (select value->>'adminMfa' from public.store_settings where key = 'auth') <> 'required'
    then raise exception 'an owner with no second factor could not write a setting'; end if;
end $$;

-- Once a factor is verified, the password alone is not enough -------------------

insert into auth.mfa_factors (user_id, status)
  values ('00000000-0000-4000-8000-0000000000a3', 'verified');

select pg_temp.act_as_aal('00000000-0000-4000-8000-0000000000a3', 'aal1') \gset
do $$ begin
  begin
    insert into public.store_settings (key, value) values ('shop', '{"name": "Sneaked in"}');
    raise exception 'a password-only session inserted a setting';
  exception when insufficient_privilege then null;
  end;
end $$;
-- An update that the policy refuses touches no rows rather than raising.
update public.store_settings set value = '{"customerSignIn": "password", "adminMfa": "off"}' where key = 'auth';
delete from public.store_settings where key = 'auth';
reset role;

do $$ begin
  if (select value->>'adminMfa' from public.store_settings where key = 'auth') <> 'required'
    then raise exception 'a password-only session turned the second factor off'; end if;
  if (select count(*) from public.store_settings where key = 'shop') <> 0
    then raise exception 'a password-only session inserted a setting'; end if;
end $$;

-- Reading is untouched: the storefront reads settings on every page ------------

select pg_temp.act_as_aal('00000000-0000-4000-8000-0000000000a3', 'aal1') \gset
do $$ begin
  if (select count(*) from public.store_settings where key = 'auth') <> 1
    then raise exception 'a password-only session could not read a setting'; end if;
end $$;
reset role;

-- With the code entered, the same owner writes again ---------------------------

select pg_temp.act_as_aal('00000000-0000-4000-8000-0000000000a3', 'aal2') \gset
update public.store_settings set value = '{"customerSignIn": "otp", "adminMfa": "off"}' where key = 'auth';
reset role;

do $$ begin
  if (select value->>'adminMfa' from public.store_settings where key = 'auth') <> 'off'
    then raise exception 'a second-factor session could not write a setting'; end if;
end $$;

-- Tidy up, so the next test file starts from the same table as before.
delete from public.store_settings where key in ('auth', 'shop');
delete from auth.mfa_factors where user_id = '00000000-0000-4000-8000-0000000000a3';

\echo store_settings_mfa: ok
