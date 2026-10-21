-- "Away mode": the owner sets a single "back on" date before leaving stock
-- in the hands of whoever's covering online orders. A daily cron job
-- (src/app/api/cron/away-mode-return/route.ts) then restores full
-- availability once that date passes -- see process_away_mode_return()
-- below for exactly what that means and why.

-- Singleton row pattern: id is always `true`, so only one row can ever
-- exist (a second insert violates the primary key).
create table if not exists public.away_mode (
  id boolean primary key default true check (id),
  return_date date,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.away_mode (id, return_date)
values (true, null)
on conflict (id) do nothing;

alter table public.away_mode enable row level security;

create policy "Away mode shop owner only"
  on public.away_mode for all
  using (public.is_shop_owner())
  with check (public.is_shop_owner());

grant select, update on public.away_mode to authenticated;
grant all on public.away_mode to service_role;

-- Once the return date has passed, restore full availability by default:
-- clear every tracked low_stock_quantity AND flip in_stock back to true,
-- including products/variants that auto-flipped to out-of-stock while the
-- covering person's handed-off batch ran out. That's deliberate -- the
-- owner tracks their real stock manually and off the website, so a sold-out
-- batch handed to a stand-in does NOT mean they have no more at home. The
-- system defaults back to "available" on their return; they mark something
-- genuinely out of stock themselves, manually, only if it truly is.
--
-- Returns true if it actually reverted something, false if away mode
-- wasn't active or the return date hasn't arrived yet (lets the cron log
-- whether it was a no-op).
create or replace function public.process_away_mode_return()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_return_date date;
begin
  select return_date into v_return_date from public.away_mode where id = true;

  if v_return_date is null or v_return_date > current_date then
    return false;
  end if;

  update public.products
  set in_stock = true, low_stock_quantity = null
  where low_stock_quantity is not null or in_stock = false;

  update public.product_variants
  set in_stock = true, low_stock_quantity = null
  where low_stock_quantity is not null or in_stock = false;

  update public.away_mode
  set return_date = null, updated_at = now()
  where id = true;

  return true;
end;
$$;

revoke execute on function public.process_away_mode_return() from public;
grant execute on function public.process_away_mode_return() to service_role;
