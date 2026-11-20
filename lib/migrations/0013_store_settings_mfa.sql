-- 0013_store_settings_mfa: writing a setting needs the second factor the
-- account has enrolled (2026-11-20).
--
-- The admin's MFA switch is a setting now (`store_settings:auth` ->
-- `adminMfa`), so the row that decides whether the admin asks for an
-- authenticator code is itself written through the Data API. Without this,
-- a session that signed in with the password alone could turn MFA off over
-- PostgREST — never mind that the admin refuses to show it the page — and
-- then walk in. While the switch lived in a generated file it was out of
-- reach; moving it into the database has to come with the same guard, in
-- the database.
--
-- The rule is Supabase's own recommendation, and it keys on what the
-- account has rather than on what a row says, so it cannot be unlocked by
-- editing the row it protects: an account with a verified factor must
-- present `aal2`, an account with none may write at `aal1` (it has nothing
-- to prove yet). Restrictive, so it narrows the owner-only policies from
-- 0012 instead of replacing them, and writes only: reading a setting stays
-- public, which the storefront needs.
--
-- The admin turns MFA off by unenrolling the factor first and then saving
-- the row, so the two never disagree. The one state this refuses writes in
-- is a factor enrolled outside the shop while the setting says 'off';
-- unenrol it, or turn the setting back on, and they agree again.
--
-- Needs 0012_store_settings.

create or replace function public.has_second_factor_if_enrolled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from auth.mfa_factors
      where user_id = auth.uid() and status = 'verified'
    )
    then coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    else true
  end;
$$;

revoke all on function public.has_second_factor_if_enrolled() from public;
grant execute on function public.has_second_factor_if_enrolled() to authenticated;

drop policy if exists "Store settings insert needs the second factor" on public.store_settings;
create policy "Store settings insert needs the second factor"
  on public.store_settings
  as restrictive
  for insert
  to authenticated
  with check (public.has_second_factor_if_enrolled());

drop policy if exists "Store settings update needs the second factor" on public.store_settings;
create policy "Store settings update needs the second factor"
  on public.store_settings
  as restrictive
  for update
  to authenticated
  using (public.has_second_factor_if_enrolled())
  with check (public.has_second_factor_if_enrolled());

drop policy if exists "Store settings delete needs the second factor" on public.store_settings;
create policy "Store settings delete needs the second factor"
  on public.store_settings
  as restrictive
  for delete
  to authenticated
  using (public.has_second_factor_if_enrolled());
