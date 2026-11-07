import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CampaignProviderClient } from '@/lib/email/providers/types';
import type { SubscriberStatus } from './rules';

/**
 * Keeping the provider's audiences in step with the shop's list.
 *
 * One Resend audience per language. Before a campaign goes out the list
 * is synced: the provider's own unsubscribes (people who used Resend's
 * link in an earlier campaign) are read back first, so nobody who left is
 * written back as subscribed; then every confirmed or unsubscribed person
 * the provider has not seen since their last change is pushed, one request
 * each. Resend allows about two requests a second, so a push runs within
 * a time budget and reports what is left; the admin calls again until
 * nothing is.
 */

export const PUSH_BUDGET_MS = 8_000;
/** Resend's limit is 2 requests a second; a little slower stays under it. */
export const REQUEST_GAP_MS = 550;
/** The provider's unsubscribes are read back at most this often. */
export const PULL_INTERVAL_MS = 10 * 60 * 1000;

export interface SyncProgress {
  locale: string;
  audienceId: string | null;
  /** Pushed in this call. */
  pushed: number;
  /** Still due after this call. */
  remaining: number;
  /** People the provider said had unsubscribed, now unsubscribed here too. */
  pulledUnsubscribes: number;
  rateLimited: boolean;
  error: string | null;
}

interface AudienceRow {
  locale: string;
  audience_id: string;
  pulled_at: string | null;
}

/**
 * Audience rows are per provider: an audience id means a Resend audience to
 * one and a Mailchimp "<list>:<tag>" to the other, so a shop that switches
 * must not read the old provider's id back.
 */
const AUDIENCE_COLUMNS = 'locale, audience_id, pulled_at';

interface DueRow {
  id: string;
  email: string;
  first_name: string | null;
  locale: string;
  status: SubscriberStatus;
  provider_contact_id: string | null;
  provider_locale: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function audienceName(shopName: string, locale: string): string {
  return `${shopName.slice(0, 80)} (${locale})`;
}

/** The audience for a language, created at the provider on first use. */
export async function ensureAudience(
  supabase: SupabaseClient,
  resend: CampaignProviderClient,
  locale: string,
  shopName: string
): Promise<{ ok: true; audience: AudienceRow } | { ok: false; error: string }> {
  const { data: existing } = await supabase
    .from('email_audiences')
    .select(AUDIENCE_COLUMNS)
    .eq('locale', locale)
    .eq('provider', resend.name)
    .maybeSingle();
  if (existing) return { ok: true, audience: existing as AudienceRow };

  // One may exist from an earlier shop install: reuse it by name.
  const name = audienceName(shopName, locale);
  const listed = await resend.listAudiences();
  if (!listed.ok) return { ok: false, error: listed.message };
  let audienceId = listed.data.find((audience) => audience.name === name)?.id ?? null;
  if (!audienceId) {
    const created = await resend.createAudience(name);
    if (!created.ok) return { ok: false, error: created.message };
    audienceId = created.data.id;
  }
  const { data: row, error } = await supabase
    .from('email_audiences')
    .upsert({ locale, provider: resend.name, audience_id: audienceId }, { onConflict: 'locale,provider' })
    .select(AUDIENCE_COLUMNS)
    .single();
  if (error || !row) return { ok: false, error: error?.message ?? 'Could not record the audience' };
  return { ok: true, audience: row as AudienceRow };
}

/**
 * Reads the provider's unsubscribes back. Someone who clicked Resend's
 * unsubscribe link is unsubscribed here too, with that in their history.
 */
export async function pullUnsubscribes(supabase: SupabaseClient, resend: CampaignProviderClient, audience: AudienceRow, now: Date): Promise<{ count: number; error: string | null }> {
  const contacts = await resend.listContacts(audience.audience_id);
  if (!contacts.ok) return { count: 0, error: contacts.message };
  const left = contacts.data.filter((contact) => contact.unsubscribed).map((contact) => contact.email.toLowerCase());
  let count = 0;
  for (let start = 0; start < left.length; start += 200) {
    const { data } = await supabase
      .from('email_subscribers')
      .update({ status: 'unsubscribed', unsubscribed_at: now.toISOString() })
      .in('email', left.slice(start, start + 200))
      .eq('status', 'subscribed')
      .select('id');
    for (const row of data ?? []) {
      count++;
      await supabase.from('email_subscriber_events').insert({ subscriber_id: row.id, event: 'unsubscribed', source: 'provider' });
    }
  }
  await supabase.from('email_audiences').update({ pulled_at: now.toISOString() }).eq('locale', audience.locale).eq('provider', resend.name);
  return { count, error: null };
}

/** How many of a language are due for a push. */
export async function countDue(supabase: SupabaseClient, locale: string): Promise<number> {
  const { count } = await supabase.from('email_subscribers').select('id', { count: 'exact', head: true }).eq('locale', locale).eq('provider_sync_due', true);
  return count ?? 0;
}

/**
 * One round of pushing, within the budget. A person who changed language
 * is removed from the old audience first. Unsubscribed people the provider
 * never had are only marked seen.
 */
export async function pushDue(
  supabase: SupabaseClient,
  resend: CampaignProviderClient,
  audience: AudienceRow,
  options: { budgetMs?: number; now?: () => number; sleep?: (ms: number) => Promise<unknown> } = {}
): Promise<{ pushed: number; rateLimited: boolean; error: string | null }> {
  const budget = options.budgetMs ?? PUSH_BUDGET_MS;
  const clock = options.now ?? Date.now;
  const pause = options.sleep ?? sleep;
  const started = clock();
  let pushed = 0;
  let calls = 0;

  const call = async <T,>(run: () => Promise<T>): Promise<T> => {
    if (calls > 0) await pause(REQUEST_GAP_MS);
    calls++;
    return run();
  };

  const { data: rows, error } = await supabase
    .from('email_subscribers')
    .select('id, email, first_name, locale, status, provider_contact_id, provider_locale')
    .eq('locale', audience.locale)
    .eq('provider_sync_due', true)
    .order('updated_at')
    .limit(50);
  if (error) return { pushed: 0, rateLimited: false, error: error.message };

  for (const row of (rows ?? []) as DueRow[]) {
    if (clock() - started > budget) break;
    let contactId = row.provider_contact_id;

    // Moved to another language: out of the old audience first.
    if (contactId && row.provider_locale && row.provider_locale !== row.locale) {
      const { data: old } = await supabase.from('email_audiences').select('audience_id').eq('locale', row.provider_locale).eq('provider', resend.name).maybeSingle();
      if (old) {
        const removed = await call(() => resend.deleteContact(old.audience_id, contactId as string));
        if (!removed.ok && removed.rateLimited) return { pushed, rateLimited: true, error: null };
      }
      contactId = null;
    }

    if (row.status === 'unsubscribed' && !contactId) {
      // Never reached the provider; nothing to tell it.
    } else if (contactId) {
      const updated = await call(() => resend.updateContact(audience.audience_id, contactId as string, { firstName: row.first_name, unsubscribed: row.status !== 'subscribed' }));
      if (!updated.ok) {
        if (updated.rateLimited) return { pushed, rateLimited: true, error: null };
        if (updated.status !== 404) return { pushed, rateLimited: false, error: `${row.email}: ${updated.message}` };
        contactId = null; // gone at the provider: recreate below if still subscribed
        if (row.status !== 'subscribed') {
          await markSynced(supabase, row.id, null, audience.locale);
          pushed++;
          continue;
        }
      }
    }
    if (!contactId && row.status === 'subscribed') {
      const created = await call(() => resend.createContact(audience.audience_id, { email: row.email, firstName: row.first_name, unsubscribed: false }));
      if (created.ok) {
        contactId = created.data.id;
      } else if (created.rateLimited) {
        return { pushed, rateLimited: true, error: null };
      } else if (/exist/i.test(created.message)) {
        // Already in the audience (an earlier run that did not get to write the id): update by address.
        const updated = await call(() => resend.updateContact(audience.audience_id, row.email, { firstName: row.first_name, unsubscribed: false }));
        if (!updated.ok) return { pushed, rateLimited: updated.rateLimited, error: updated.rateLimited ? null : `${row.email}: ${updated.message}` };
        contactId = updated.data.id ?? row.email;
      } else {
        return { pushed, rateLimited: false, error: `${row.email}: ${created.message}` };
      }
    }
    await markSynced(supabase, row.id, contactId, audience.locale);
    pushed++;
  }
  return { pushed, rateLimited: false, error: null };
}

async function markSynced(supabase: SupabaseClient, id: string, contactId: string | null, locale: string) {
  await supabase
    .from('email_subscribers')
    .update({ provider_contact_id: contactId, provider_locale: locale, provider_synced_at: new Date().toISOString() })
    .eq('id', id);
}

/** One sync step for a language: audience, pull (when due), one push round. */
export async function syncAudienceStep(
  supabase: SupabaseClient,
  resend: CampaignProviderClient,
  locale: string,
  shopName: string,
  options: { forcePull?: boolean; budgetMs?: number; now?: Date } = {}
): Promise<SyncProgress> {
  const now = options.now ?? new Date();
  const progress: SyncProgress = { locale, audienceId: null, pushed: 0, remaining: 0, pulledUnsubscribes: 0, rateLimited: false, error: null };
  const ensured = await ensureAudience(supabase, resend, locale, shopName);
  if (!ensured.ok) return { ...progress, error: ensured.error, remaining: await countDue(supabase, locale) };
  progress.audienceId = ensured.audience.audience_id;

  const pulledAt = ensured.audience.pulled_at ? Date.parse(ensured.audience.pulled_at) : 0;
  if (options.forcePull || now.getTime() - pulledAt > PULL_INTERVAL_MS) {
    const pulled = await pullUnsubscribes(supabase, resend, ensured.audience, now);
    progress.pulledUnsubscribes = pulled.count;
    if (pulled.error) return { ...progress, error: pulled.error, remaining: await countDue(supabase, locale) };
  }

  const pushed = await pushDue(supabase, resend, ensured.audience, { budgetMs: options.budgetMs });
  progress.pushed = pushed.pushed;
  progress.rateLimited = pushed.rateLimited;
  progress.error = pushed.error;
  progress.remaining = await countDue(supabase, locale);
  return progress;
}
