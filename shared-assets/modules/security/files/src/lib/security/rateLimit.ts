import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Checks and records a hit against a shared (Postgres-backed) rate limit,
 * so it works correctly across serverless instances. Returns true if the
 * caller is still within the limit. Fails OPEN (allows the request) on an
 * infrastructure error — a rate limiter outage must never take down a form.
 */
export async function checkRateLimit({
  key,
  windowSeconds,
  maxHits,
}: {
  key: string;
  windowSeconds: number;
  maxHits: number;
}): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("rate_limit_check", {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max_hits: maxHits,
  });

  if (error) {
    console.error("[RateLimit] Check failed, failing open:", error);
    return true;
  }

  return data === true;
}
