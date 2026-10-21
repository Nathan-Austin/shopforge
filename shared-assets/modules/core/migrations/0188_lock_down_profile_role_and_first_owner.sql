-- Security fixes for profile roles and carts.
--
-- 1. "Profiles update own" lets a user update ANY column of their own profile
--    row, including `role`. A customer could PATCH /rest/v1/profiles with
--    {"role":"shop_owner"} using the public anon key + their own session and
--    pass every is_shop_owner() check. A column-level REVOKE would not help:
--    0148 grants table-level UPDATE to authenticated, which overrides
--    column-level revokes, and updateProfile.ts legitimately updates other
--    columns. So a BEFORE trigger rejects role changes made through the Data API
--    roles (anon/authenticated). service_role, postgres (migrations, SQL editor)
--    and security-definer functions such as handle_new_user() are unaffected.
--
-- 2. handle_new_user() made the first signup a shop_owner when no owner
--    existed. Always create 'customer'; owners are promoted manually via the
--    SQL editor or service role.
--
-- 3. cart_items: locked to service-role only in 0162 (all cart access goes
--    through createAdminClient()). Re-asserted here idempotently, plus table
--    grants revoked so a future re-run of 0148's grant loop can't reopen it
--    through a new permissive policy.

-- 1. Profile role guard ------------------------------------------------------

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT'
       and new.role is distinct from 'customer'
       -- allow an upsert that keeps the caller's existing role unchanged (api/profile)
       and not exists (select 1 from public.profiles p where p.id = new.id and p.role = new.role) then
      raise exception 'Not allowed to set profiles.role' using errcode = '42501';
    end if;

    if tg_op = 'UPDATE' and new.role is distinct from old.role then
      raise exception 'Not allowed to change profiles.role' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_role on public.profiles;
create trigger trg_profiles_guard_role
  before insert or update on public.profiles
  for each row
  execute function public.guard_profile_role();

-- 2. No first-signup promotion ----------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role)
    values (new.id, 'customer')
    on conflict (id) do nothing;
  return new;
end;
$$;

-- create or replace keeps existing ACLs; re-asserted from 0163 for clarity.
revoke execute on function public.handle_new_user() from public;

-- 3. cart_items: server-only (re-assert 0162) ---------------------------------

drop policy if exists "Cart items access" on public.cart_items;
drop policy if exists "No public access to cart_items" on public.cart_items;
create policy "No public access to cart_items"
  on public.cart_items for all
  using (false)
  with check (false);

revoke all on public.cart_items from anon, authenticated;
