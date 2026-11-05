-- product-images: anyone reads, only the shop owner uploads, replaces or
-- deletes. Run by test/check-schema.sh after lib/storage-policies.sql.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a2', 'owner2@shop.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'customer2@shop.test')
on conflict do nothing;
update public.profiles set role = 'shop_owner' where id = '00000000-0000-4000-8000-0000000000a2';

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  -- Both claims, as Supabase sets them: the old policies checked auth.role().
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('request.jwt.claim.role', case when p_user is null then 'anon' else 'authenticated' end, false);
  if p_user is null then set role anon; else set role authenticated; end if;
end $$;

-- The owner uploads, replaces and deletes.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000a2') \gset
insert into storage.objects (id, bucket_id, name) values ('00000000-0000-4000-8000-00000000f001', 'product-images', 'email/a.jpg');
update storage.objects set name = 'email/b.jpg' where id = '00000000-0000-4000-8000-00000000f001';
reset role;

-- A customer cannot upload, replace or delete.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000c2') \gset
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('product-images', 'evil.jpg');
    raise exception 'a customer uploaded to product-images';
  exception when insufficient_privilege then null;
  end;
  update storage.objects set name = 'hijacked.jpg' where bucket_id = 'product-images';
  delete from storage.objects where bucket_id = 'product-images';
end $$;
reset role;
do $$ begin
  if (select name from storage.objects where id = '00000000-0000-4000-8000-00000000f001') is distinct from 'email/b.jpg' then
    raise exception 'a customer changed or deleted an owner upload';
  end if;
end $$;

-- Visitors and customers can still read.
select pg_temp.act_as(null) \gset
do $$ begin
  if (select count(*) from storage.objects where bucket_id = 'product-images') <> 1 then raise exception 'anon cannot read product images'; end if;
  begin
    insert into storage.objects (bucket_id, name) values ('product-images', 'anon.jpg');
    raise exception 'anon uploaded to product-images';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The old "any authenticated user" policies are gone.
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname like 'Authenticated %product-images') then
    raise exception 'the old authenticated-user policies are still there';
  end if;
end $$;

select pg_temp.act_as('00000000-0000-4000-8000-0000000000a2') \gset
delete from storage.objects where id = '00000000-0000-4000-8000-00000000f001';
reset role;
do $$ begin
  if exists (select 1 from storage.objects where id = '00000000-0000-4000-8000-00000000f001') then raise exception 'the owner could not delete'; end if;
end $$;

\echo storage_policies: ok
