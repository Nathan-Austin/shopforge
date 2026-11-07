import 'server-only';

import { createAdminClient } from '../supabase/admin';
import type { CampaignProviderName } from './providers/types';

/**
 * Where an email provider's API key comes from.
 *
 * Two places, in this order:
 *
 *   1. the environment — `RESEND_API_KEY`, `MAILCHIMP_API_KEY`. Still the
 *      simplest way to run a shop, needs no database round trip, and is the
 *      way out if Vault is ever unavailable.
 *   2. Supabase Vault, where a key typed into the admin is kept. Read with
 *      the service-role key through get_email_provider_key(), which has
 *      execute revoked from `authenticated` — so this module is the only
 *      way a key is ever seen, and never by a browser.
 *
 * The environment wins on purpose: an owner who sets the variable should get
 * what they set, not something typed into the dashboard months ago.
 */

/** How long a key read from Vault is reused before being read again. */
const CACHE_MS = 60_000;

const ENV_VARIABLE: Record<CampaignProviderName, string> = {
  resend: 'RESEND_API_KEY',
  mailchimp: 'MAILCHIMP_API_KEY'
};

const cached = new Map<string, { key: string | null; at: number }>();

/**
 * Drop the cached keys. Called after the admin stores or clears one, so a
 * rotation takes effect at once rather than at the end of the window.
 */
export function forgetEmailProviderKey(): void {
  cached.clear();
}

/** One provider's key, or null when the shop has none for it. */
export async function loadProviderKey(provider: CampaignProviderName): Promise<string | null> {
  const fromEnv = process.env[ENV_VARIABLE[provider]]?.trim();
  if (fromEnv) return fromEnv;

  // No service-role client, nothing in Vault to read: a unit test, or a shop
  // not yet pointed at Supabase.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;

  const hit = cached.get(provider);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.key;

  let key: string | null = null;
  try {
    const { data, error } = await createAdminClient().rpc('get_email_provider_key', {
      p_provider: provider
    });
    // A shop generated before 0010 has no such function; that is a shop with
    // no stored key, not a failure worth throwing out of an email send.
    if (!error && typeof data === 'string' && data.trim()) key = data.trim();
  } catch {
    key = null;
  }

  cached.set(provider, { key, at: Date.now() });
  return key;
}

/**
 * The transactional key. Always Resend: receipts, refund and shipping mail
 * go through it whatever sends the campaigns, because Mailchimp has no
 * transactional product behind this key.
 */
export async function loadEmailProviderKey(): Promise<string | null> {
  return loadProviderKey('resend');
}
