-- 0014: every shop has the chilli tables, whatever mode it was generated
-- in, with the same read-for-everyone, write-for-the-owner rules as the
-- rest of the catalogue, and heat on the storefront view.
-- Run by test/check-schema.sh against both modes.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'owner14@shop.test'),
  ('00000000-0000-4000-8000-0000000000e2', 'customer14@shop.test')
on conflict do nothing;
update public.profiles set role = 'shop_owner' where id = '00000000-0000-4000-8000-0000000000e1';

create or replace function pg_temp.act_as14(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('request.jwt.claim.role', case when p_user is null then 'anon' else 'authenticated' end, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', 'aal2')::text, false);
  if p_user is null then set role anon; else set role authenticated; end if;
end $$;

-- The shape is there in both modes ------------------------------------------

do $$ begin
  if to_regclass('public.chilli_types') is null then raise exception 'no chilli_types table'; end if;
  if to_regclass('public.products_chilli_types') is null then raise exception 'no join table'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name in ('heat_level', 'scoville_shu')
    having count(*) = 2
  ) then raise exception 'products is missing the heat columns'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products_public' and column_name = 'heat_level'
  ) then raise exception 'products_public does not expose heat_level'; end if;
end $$;

-- The owner writes, and heat reaches the storefront view ---------------------

select pg_temp.act_as14('00000000-0000-4000-8000-0000000000e1') \gset
insert into public.chilli_types (name, slug, heat_level) values ('Test Habanero', 'test-habanero', 7);
insert into public.products (name, slug, price_cents, heat_level, scoville_shu)
  values ('Test Hot Sauce', 'test-hot-sauce', 1000, 8, 50000);
insert into public.products_chilli_types (product_id, chilli_type_id)
  select p.id, c.id from public.products p, public.chilli_types c
   where p.slug = 'test-hot-sauce' and c.slug = 'test-habanero';
reset role;

do $$ begin
  if (select heat_level from public.products_public where slug = 'test-hot-sauce') <> 8
    then raise exception 'the view does not carry heat'; end if;
  if (select scoville_shu from public.products_public where slug = 'test-hot-sauce') <> 50000
    then raise exception 'the view does not carry Scoville'; end if;
end $$;

-- The ids as superuser: a customer cannot read `products` at all (the
-- storefront reads the view), so an insert ... select of theirs would
-- quietly match no rows and prove nothing about the policy.
select id as test_product_id from public.products where slug = 'test-hot-sauce' \gset
select id as test_type_id from public.chilli_types where slug = 'test-habanero' \gset

-- Everyone reads the types, nobody but the owner writes them -----------------

select pg_temp.act_as14('00000000-0000-4000-8000-0000000000e2') \gset
do $$ begin
  if (select count(*) from public.chilli_types where slug = 'test-habanero') <> 1
    then raise exception 'a customer cannot read the chilli types'; end if;
  begin
    insert into public.chilli_types (name, slug) values ('Sneaked', 'sneaked');
    raise exception 'a customer could add a chilli type';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Outside a DO block: psql fills :variables in plain statements only, and
-- the policy's refusal is the expected outcome here.
\set ON_ERROR_STOP off
insert into public.products_chilli_types (product_id, chilli_type_id)
  values (:'test_product_id', :'test_type_id');
\set ON_ERROR_STOP on
reset role;

do $$ begin
  -- Still just the owner's link.
  if (select count(*) from public.products_chilli_types) <> 1
    then raise exception 'a customer could link a chilli type'; end if;
end $$;

select pg_temp.act_as14(null) \gset
do $$ begin
  if (select count(*) from public.chilli_types where slug = 'test-habanero') <> 1
    then raise exception 'an anonymous visitor cannot read the chilli types'; end if;
end $$;
reset role;

-- Tidy up, so the next test file starts from the same tables as before.
delete from public.products_chilli_types
  where product_id in (select id from public.products where slug = 'test-hot-sauce');
delete from public.products where slug = 'test-hot-sauce';
delete from public.chilli_types where slug in ('test-habanero', 'sneaked');

\echo chilli_everywhere: ok
