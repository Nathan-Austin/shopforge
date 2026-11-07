import 'server-only';

import { loadProviderKey } from '../providerKey';
import { createMailchimpClient, MAILCHIMP_PASSTHROUGH_TAGS, MAILCHIMP_UNSUBSCRIBE_PLACEHOLDER } from './mailchimp';
import { createResendClient, RESEND_PASSTHROUGH_TAGS, RESEND_UNSUBSCRIBE_PLACEHOLDER } from './resend';
import type { CampaignProviderClient, CampaignProviderName } from './types';
import type { PassthroughTags } from '../campaigns/mergeTags';

/**
 * Which provider sends this shop's campaigns, and how to build it.
 *
 * Receipts are not decided here. Transactional mail is Resend's alone —
 * Mailchimp does not send it (that is Mandrill, a separate product and key)
 * — so `resolveEmailConfig()` stays the answer for receipts and this file is
 * only about campaigns.
 *
 * The choice comes from, in order:
 *
 *   1. `EMAIL_CAMPAIGN_PROVIDER` in the environment, for a shop that would
 *      rather configure everything in one place;
 *   2. the `is_active` row in `email_provider_keys`, set from
 *      /admin/email/settings;
 *   3. Resend, which is what a shop that has never chosen gets.
 */

export const CAMPAIGN_PROVIDERS = ['resend', 'mailchimp'] as const;

export function isCampaignProviderName(value: unknown): value is CampaignProviderName {
  return typeof value === 'string' && (CAMPAIGN_PROVIDERS as readonly string[]).includes(value);
}

/** The provider placeholders that stand in for our recipient merge tags. */
export function passthroughTagsFor(provider: CampaignProviderName): PassthroughTags {
  return provider === 'mailchimp' ? MAILCHIMP_PASSTHROUGH_TAGS : RESEND_PASSTHROUGH_TAGS;
}

export function unsubscribePlaceholderFor(provider: CampaignProviderName): string {
  return provider === 'mailchimp' ? MAILCHIMP_UNSUBSCRIBE_PLACEHOLDER : RESEND_UNSUBSCRIBE_PLACEHOLDER;
}

/** The provider a client would be built for, without building one. */
export async function activeCampaignProviderName(): Promise<CampaignProviderName> {
  const fromEnv = process.env.EMAIL_CAMPAIGN_PROVIDER?.trim().toLowerCase();
  if (isCampaignProviderName(fromEnv)) return fromEnv;
  const stored = await loadActiveProviderFromDatabase();
  return stored ?? 'resend';
}

async function loadActiveProviderFromDatabase(): Promise<CampaignProviderName | null> {
  // Nothing to ask without a service-role client: that is a unit test or a
  // shop that has not been pointed at Supabase yet, and both mean Resend.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const { createAdminClient } = await import('../../supabase/admin');
    const { data } = await createAdminClient()
      .from('email_provider_keys')
      .select('provider')
      .eq('is_active', true)
      .maybeSingle();
    const provider = (data as { provider?: string } | null)?.provider;
    return isCampaignProviderName(provider) ? provider : null;
  } catch {
    // A shop generated before 0011 has no is_active column; that is Resend.
    return null;
  }
}

/**
 * The campaign provider for this shop, or null when it has no key for the
 * provider it has chosen. Mailchimp's list id is optional: with none set the
 * client uses the account's only audience.
 */
export async function createCampaignProvider(): Promise<CampaignProviderClient | null> {
  const name = await activeCampaignProviderName();
  const apiKey = await loadProviderKey(name);
  if (!apiKey) return null;

  if (name === 'mailchimp') {
    return createMailchimpClient({
      apiKey,
      listId: process.env.MAILCHIMP_LIST_ID?.trim() || null
    });
  }
  return createResendClient({ apiKey });
}
