-- Automatically create a profiles row when a new auth user is confirmed.
-- The first user to confirm gets 'shop_owner'; all subsequent users get 'customer'.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_count integer;
begin
  select count(*) into owner_count from public.profiles where role = 'shop_owner';
  insert into public.profiles (id, role)
    values (new.id, case when owner_count = 0 then 'shop_owner' else 'customer' end)
    on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
