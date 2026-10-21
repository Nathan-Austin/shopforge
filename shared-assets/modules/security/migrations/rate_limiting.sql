-- Shared rate-limiting store for bot/spam protection across server actions
-- and route handlers. One row per (route+scope+identifier) key; atomically
-- incremented (or reset, if the window elapsed) by rate_limit_check().

create table if not exists public.rate_limit_hits (
  key text primary key,
  window_start timestamptz not null default now(),
  hit_count integer not null default 1
);

create index if not exists rate_limit_hits_window_start_idx
  on public.rate_limit_hits (window_start);

-- Atomically records a hit for `p_key` and reports whether the caller is
-- still within `p_max_hits` for the current `p_window_seconds` window.
-- The INSERT ... ON CONFLICT takes a row lock, so concurrent calls for the
-- same key are serialized (no separate SELECT-then-UPDATE race).
create or replace function public.rate_limit_check(
  p_key text,
  p_window_seconds integer,
  p_max_hits integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.rate_limit_hits as r (key, window_start, hit_count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hit_count = case
          when r.window_start < now() - make_interval(secs => p_window_seconds)
            then 1
          else r.hit_count + 1
        end,
        window_start = case
          when r.window_start < now() - make_interval(secs => p_window_seconds)
            then now()
          else r.window_start
        end
  returning hit_count into v_count;

  return v_count <= p_max_hits;
end;
$$;

-- rate_limit_check is SECURITY DEFINER and Postgres grants EXECUTE to PUBLIC
-- by default, so anon/authenticated could otherwise call it via PostgREST
-- (/rest/v1/rpc/rate_limit_check) to read or manipulate other callers'
-- counters. It is only ever called from server code via the service role.
revoke execute on function public.rate_limit_check(text, integer, integer) from public;
revoke execute on function public.rate_limit_check(text, integer, integer) from anon, authenticated;

grant all on public.rate_limit_hits to postgres, service_role;
grant execute on function public.rate_limit_check(text, integer, integer) to postgres, service_role;

-- No policies: anon/authenticated get no access at all (service_role
-- bypasses RLS), matching the "server-code only" access model above.
alter table public.rate_limit_hits enable row level security;
