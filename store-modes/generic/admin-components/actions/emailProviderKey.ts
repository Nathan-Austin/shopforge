'use server';

import { revalidatePath } from 'next/cache';

import { forgetEmailProviderKey } from '@/lib/email/providerKey';
import { createResendClient } from '@/lib/email/providers/resend';
import { ensureShopOwner } from '../lib/auth';

/**
 * Storing the campaign provider's key.
 *
 * The key is tested before it is kept: the owner's typo should be a message
 * on the form, not a campaign that fails at three in the morning. Only a key
 * that Resend accepted is written, and it goes to Supabase Vault through
 * set_email_provider_key — never to a table in public, and never back to a
 * browser. The form clears itself afterwards and says so.
 */

interface Context {
  locale: string;
}

export type ProviderKeyActionResult =
  | { ok: true; action: 'saved' | 'cleared'; lastFour?: string }
  | {
      ok: false;
      error:
        | 'not_authorized'
        | 'empty'
        | 'too_short'
        | 'rejected'
        | 'unreachable'
        | 'no_vault'
        | 'failed';
      message?: string;
    };

/** Resend's keys look like re_… ; anything much shorter is a paste gone wrong. */
const MIN_KEY_LENGTH = 8;

function refresh(locale: string) {
  revalidatePath(`/${locale}/admin/email/settings`);
  revalidatePath(`/${locale}/admin/email`);
}

export async function saveEmailProviderKey(
  context: Context,
  _previous: ProviderKeyActionResult | null,
  formData: FormData
): Promise<ProviderKeyActionResult> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const key = formData.get('api_key')?.toString().trim() ?? '';
  if (!key) return { ok: false, error: 'empty' };
  if (key.length < MIN_KEY_LENGTH) return { ok: false, error: 'too_short' };

  // The test. listAudiences is the cheapest authenticated call Resend has,
  // and it fails the same way a bad key would on a real send.
  const probe = await createResendClient({ apiKey: key }).listAudiences();
  if (!probe.ok) {
    // 401/403 is the key itself; anything else is Resend or the network, and
    // saying so stops the owner from retyping a key that was fine.
    if (probe.status === 401 || probe.status === 403) {
      return { ok: false, error: 'rejected', message: probe.message };
    }
    return { ok: false, error: 'unreachable', message: probe.message };
  }

  const { error: rpcError } = await supabase.rpc('set_email_provider_key', {
    p_provider: 'resend',
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
  return { ok: true, action: 'saved', lastFour: key.slice(-4) };
}

export async function clearEmailProviderKey(
  context: Context,
  _previous: ProviderKeyActionResult | null,
  _formData: FormData
): Promise<ProviderKeyActionResult> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const { error: rpcError } = await supabase.rpc('clear_email_provider_key', {
    p_provider: 'resend'
  });
  if (rpcError) return { ok: false, error: 'failed', message: rpcError.message };

  forgetEmailProviderKey();
  refresh(context.locale);
  return { ok: true, action: 'cleared' };
}
