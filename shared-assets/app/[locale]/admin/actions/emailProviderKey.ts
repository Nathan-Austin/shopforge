'use server';

import { revalidatePath } from 'next/cache';

import { forgetEmailProviderKey } from '@/lib/email/providerKey';
import { createMailchimpClient } from '@/lib/email/providers/mailchimp';
import { isCampaignProviderName } from '@/lib/email/providers/registry';
import { createResendClient } from '@/lib/email/providers/resend';
import type { CampaignProviderClient, CampaignProviderName } from '@/lib/email/providers/types';
import { ensureShopOwner } from '../lib/auth';

/**
 * Storing a campaign provider's key, and choosing which provider sends.
 *
 * The key is tested before it is kept: the owner's typo should be a message
 * on the form, not a campaign that fails at three in the morning. Only a key
 * the provider accepted is written, and it goes to Supabase Vault through
 * set_email_provider_key — never to a table in public, and never back to a
 * browser. The form clears itself afterwards and says so.
 *
 * A shop may hold a key for each provider; exactly one is active, which is
 * what the database's partial unique index enforces.
 */

interface Context {
  locale: string;
}

export type ProviderKeyActionResult =
  | { ok: true; action: 'saved' | 'cleared' | 'chosen'; provider: CampaignProviderName; lastFour?: string }
  | {
      ok: false;
      error:
        | 'not_authorized'
        | 'unknown_provider'
        | 'empty'
        | 'too_short'
        | 'rejected'
        | 'unreachable'
        | 'no_vault'
        | 'no_key'
        | 'failed';
      message?: string;
    };

/** Keys are at least this long at both providers; shorter is a bad paste. */
const MIN_KEY_LENGTH = 8;

function refresh(locale: string) {
  revalidatePath(`/${locale}/admin/email/settings`);
  revalidatePath(`/${locale}/admin/email/campaigns`);
  revalidatePath(`/${locale}/admin/email`);
}

function clientFor(provider: CampaignProviderName, apiKey: string): CampaignProviderClient {
  // No list id: verifyKey does not need one, and the real client picks the
  // account's audience when the shop has not named one.
  return provider === 'mailchimp' ? createMailchimpClient({ apiKey }) : createResendClient({ apiKey });
}

function readProvider(formData: FormData): CampaignProviderName | null {
  const value = formData.get('provider')?.toString().trim().toLowerCase() ?? '';
  return isCampaignProviderName(value) ? value : null;
}

export async function saveEmailProviderKey(
  context: Context,
  _previous: ProviderKeyActionResult | null,
  formData: FormData
): Promise<ProviderKeyActionResult> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const provider = readProvider(formData);
  if (!provider) return { ok: false, error: 'unknown_provider' };

  const key = formData.get('api_key')?.toString().trim() ?? '';
  if (!key) return { ok: false, error: 'empty' };
  if (key.length < MIN_KEY_LENGTH) return { ok: false, error: 'too_short' };

  // The test. Reaching here means the provider itself accepted the key.
  const probe = await clientFor(provider, key).verifyKey();
  if (!probe.ok) {
    // 401/403 is the key itself; anything else is the provider or the
    // network, and saying so stops the owner retyping a key that was fine.
    if (probe.status === 401 || probe.status === 403) {
      return { ok: false, error: 'rejected', message: probe.message };
    }
    return { ok: false, error: 'unreachable', message: probe.message };
  }

  const { error: rpcError } = await supabase.rpc('set_email_provider_key', {
    p_provider: provider,
    p_key: key
  });

  if (rpcError) {
    // 0A000 is the migration's own "Vault is not enabled here".
    if (rpcError.code === '0A000') return { ok: false, error: 'no_vault', message: rpcError.message };
    return { ok: false, error: 'failed', message: rpcError.message };
  }

  // The server may have the old key cached for up to a minute otherwise.
  forgetEmailProviderKey();
  refresh(context.locale);
  return { ok: true, action: 'saved', provider, lastFour: key.slice(-4) };
}

export async function clearEmailProviderKey(
  context: Context,
  _previous: ProviderKeyActionResult | null,
  formData: FormData
): Promise<ProviderKeyActionResult> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const provider = readProvider(formData);
  if (!provider) return { ok: false, error: 'unknown_provider' };

  const { error: rpcError } = await supabase.rpc('clear_email_provider_key', { p_provider: provider });
  if (rpcError) return { ok: false, error: 'failed', message: rpcError.message };

  forgetEmailProviderKey();
  refresh(context.locale);
  return { ok: true, action: 'cleared', provider };
}

/** Switch which provider sends campaigns. Only one with a stored key. */
export async function chooseEmailProvider(
  context: Context,
  _previous: ProviderKeyActionResult | null,
  formData: FormData
): Promise<ProviderKeyActionResult> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const provider = readProvider(formData);
  if (!provider) return { ok: false, error: 'unknown_provider' };

  const { error: rpcError } = await supabase.rpc('set_active_email_provider', { p_provider: provider });
  if (rpcError) {
    // The function refuses a provider the shop has no key for.
    if (rpcError.code === '22023') return { ok: false, error: 'no_key', message: rpcError.message };
    return { ok: false, error: 'failed', message: rpcError.message };
  }

  refresh(context.locale);
  return { ok: true, action: 'chosen', provider };
}
