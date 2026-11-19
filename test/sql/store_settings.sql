-- store_settings (0012): anyone may read a setting, only the owner may write
-- one, keys are plain identifiers and values are JSON objects.
-- Run by test/check-schema.sh.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ac', 'owner12@shop.test'),
  ('00000000-0000-4000-8000-0000000000cc', 'customer12@shop.test')
on conflict do nothing;
update public.profiles set role = 'shop_owner' where id = '00000000-0000-4000-8000-0000000000ac';

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('request.jwt.claim.role', case when p_user is null then 'anon' else 'authenticated' end, false);
  if p_user is null then set role anon; else set role authenticated; end if;
end $$;

-- The owner writes ---------------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000000ac') \gset
insert into public.store_settings (key, value, updated_by)
  values ('email_brand', '{"brandColor": "#aa0000"}', '00000000-0000-4000-8000-0000000000ac')
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
reset role;

do $$ begin
  if (select value->>'brandColor' from public.store_settings where key = 'email_brand') <> '#aa0000'
    then raise exception 'the owner could not store a setting'; end if;
end $$;

-- An update moves updated_at on, whatever the client sent.
update public.store_settings set updated_at = '2000-01-01' where key = 'email_brand';
select pg_temp.act_as('00000000-0000-4000-8000-0000000000ac') \gset
update public.store_settings set value = '{"brandColor": "#bb0000"}' where key = 'email_brand';
reset role;
do $$ begin
  if (select updated_at from public.store_settings where key = 'email_brand') < now() - interval '1 minute'
    then raise exception 'updated_at did not follow the write'; end if;
end $$;

-- Everyone reads -----------------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000000cc') \gset
do $$ begin
  if (select count(*) from public.store_settings where key = 'email_brand') <> 1
    then raise exception 'a customer cannot read a setting'; end if;
end $$;
reset role;

select pg_temp.act_as(null) \gset
do $$ begin
  if (select count(*) from public.store_settings where key = 'email_brand') <> 1
    then raise exception 'an anonymous visitor cannot read a setting'; end if;
end $$;
reset role;

-- Only the owner writes ------------------------------------------------------------

select pg_temp.act_as('00000000-0000-4000-8000-0000000000cc') \gset
do $$ begin
  begin
    insert into public.store_settings (key, value) values ('currency', '{"code": "EUR"}');
    raise exception 'a customer could add a setting';
  exception when insufficient_privilege then null;
  end;
  update public.store_settings set value = '{"brandColor": "#000000"}' where key = 'email_brand';
  delete from public.store_settings where key = 'email_brand';
end $$;
reset role;

do $$ begin
  -- RLS hides the row from the customer's update and delete, so both are no-ops.
  if (select value->>'brandColor' from public.store_settings where key = 'email_brand') <> '#bb0000'
    then raise exception 'a customer could change or remove a setting'; end if;
end $$;

select pg_temp.act_as(null) \gset
do $$ begin
  begin
    insert into public.store_settings (key, value) values ('currency', '{"code": "EUR"}');
    raise exception 'an anonymous visitor could add a setting';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Shape -----------------------------------------------------------------------

do $$ begin
  begin
    insert into public.store_settings (key, value) values ('Email Brand', '{}');
    raise exception 'a key with spaces and capitals was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.store_settings (key, value) values ('list_setting', '[1, 2]');
    raise exception 'a non-object value was accepted';
  exception when check_violation then null;
  end;
end $$;

delete from public.store_settings where key = 'email_brand';

\echo store_settings: ok
