import 'server-only';

import { createAdminClient } from '../supabase/admin';

/**
 * Where the email provider's API key comes from.
 *
 * Two places, in this order:
 *
 *   1. `RESEND_API_KEY` in the environment. Still the simplest way to run a
 *      shop, needs no database round trip, and is the way out if Vault is
 *      ever unavailable.
 *   2. Supabase Vault, where a key typed into the admin is kept. Read with
 *      the service-role key through get_email_provider_key(), which has
 *      execute revoked from `authenticated` — so this module is the only
 *      way the key is ever seen, and never by a browser.
 *
 * The environment wins on purpose: an owner who sets the variable should get
 * what they set, not something typed into the dashboard months ago.
 */

/** How long a key read from Vault is reused before being read again. */
const CACHE_MS = 60_000;

let cached: { key: string | null; at: number } | null = null;

/**
 * Drop the cached key. Called after the admin stores or clears one, so a
 * rotation takes effect at once rather than at the end of the window.
 */
export function forgetEmailProviderKey(): void {
  cached = null;
}

/** The provider key, or null when the shop has none. */
export async function loadEmailProviderKey(): Promise<string | null> {
  const fromEnv = process.env.RESEND_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  if (cached && Date.now() - cached.at < CACHE_MS) return cached.key;

  let key: string | null = null;
  try {
    const { data, error } = await createAdminClient().rpc('get_email_provider_key', {
      p_provider: 'resend'
    });
    // A shop generated before 0010 has no such function; that is a shop with
    // no stored key, not a failure worth throwing out of an email send.
    if (!error && typeof data === 'string' && data.trim()) key = data.trim();
  } catch {
    key = null;
  }

  cached = { key, at: Date.now() };
  return key;
}
