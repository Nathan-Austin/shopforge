-- email_templates: only the shop owner reads or writes; the checks hold.
-- Run by test/check-schema.sh against a scratch database with the schema
-- applied. Any failed assertion raises and stops the run.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@shop.test'),
  ('00000000-0000-4000-8000-0000000000c1', 'customer@shop.test')
on conflict do nothing;
update public.profiles set role = 'shop_owner' where id = '00000000-0000-4000-8000-0000000000a1';

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  if p_user is null then
    set role anon;
  else
    set role authenticated;
  end if;
end $$;

-- The owner creates, reads, updates and deletes.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000a1') \gset
insert into public.email_templates (id, name, document)
values ('00000000-0000-4000-8000-00000000e001', 'Spring sale', '{"version": 1, "blocks": []}');
do $$ begin
  if (select count(*) from public.email_templates) <> 1 then raise exception 'owner cannot read their template'; end if;
end $$;
update public.email_templates set name = 'Spring sale 2' where id = '00000000-0000-4000-8000-00000000e001';

-- The backstop checks refuse what the app would never write.
do $$
declare
  bad jsonb[] := array['[]'::jsonb, '"text"'::jsonb, '{"version": 2}'::jsonb, '{"blocks": []}'::jsonb,
                       jsonb_build_object('version', 1, 'pad', repeat('x', 300000))];
  doc jsonb;
begin
  foreach doc in array bad loop
    begin
      insert into public.email_templates (name, document) values ('Bad', doc);
      raise exception 'accepted a bad document: %', left(doc::text, 60);
    exception when check_violation then null;
    end;
  end loop;
  begin
    insert into public.email_templates (name, document) values ('   ', '{"version": 1}');
    raise exception 'accepted a blank name';
  exception when check_violation then null;
  end;
  begin
    insert into public.email_templates (name, kind, document) values ('X', 'transactional', '{"version": 1}');
    raise exception 'accepted an unknown kind';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- A customer sees nothing and can write nothing.
select pg_temp.act_as('00000000-0000-4000-8000-0000000000c1') \gset
do $$ begin
  if (select count(*) from public.email_templates) <> 0 then raise exception 'a customer can read templates'; end if;
  begin
    insert into public.email_templates (name, document) values ('Mine', '{"version": 1}');
    raise exception 'a customer inserted a template';
  exception when insufficient_privilege then null;
  end;
  update public.email_templates set name = 'Hacked';
  delete from public.email_templates;
end $$;
reset role;
do $$ begin
  if (select name from public.email_templates where id = '00000000-0000-4000-8000-00000000e001') <> 'Spring sale 2' then
    raise exception 'a customer changed a template';
  end if;
end $$;

-- A visitor without a session has no access at all.
select pg_temp.act_as(null) \gset
do $$ begin
  begin
    perform 1 from public.email_templates;
    raise exception 'anon can read templates';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- updated_at moves on update.
do $$
declare before timestamptz;
begin
  select updated_at into before from public.email_templates where id = '00000000-0000-4000-8000-00000000e001';
  perform pg_sleep(0.01);
  update public.email_templates set name = 'Spring sale 3' where id = '00000000-0000-4000-8000-00000000e001';
  if (select updated_at from public.email_templates where id = '00000000-0000-4000-8000-00000000e001') <= before then
    raise exception 'updated_at did not move';
  end if;
end $$;

select pg_temp.act_as('00000000-0000-4000-8000-0000000000a1') \gset
delete from public.email_templates where id = '00000000-0000-4000-8000-00000000e001';
reset role;

\echo email_templates: ok
