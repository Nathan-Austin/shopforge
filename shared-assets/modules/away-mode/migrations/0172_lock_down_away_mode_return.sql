-- process_away_mode_return() (migration 0171) is SECURITY DEFINER and was
-- only revoked FROM PUBLIC, same gap migration 0163 already documented and
-- fixed for reduce_stock(): Supabase's default privileges on the public
-- schema grant EXECUTE on new functions to anon/authenticated directly, not
-- just via PUBLIC membership, so revoking from PUBLIC alone is a no-op for
-- them. Confirmed via has_function_privilege() that anon/authenticated
-- could call /rest/v1/rpc/process_away_mode_return directly -- only ever
-- meant to be called by the cron route via the service-role client
-- (src/app/api/cron/away-mode-return/route.ts).

revoke execute on function public.process_away_mode_return() from anon, authenticated;
