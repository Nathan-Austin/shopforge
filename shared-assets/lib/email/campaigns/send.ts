import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveEmailConfig } from '@/lib/email/config';
import { createCampaignProvider, passthroughTagsFor, unsubscribePlaceholderFor } from '@/lib/email/providers/registry';
import type { CampaignProviderClient, CampaignProviderName } from '@/lib/email/providers/types';
import { appendEmailTmpLog } from '@/lib/email/tmpDir';
import {
  broadcastName,
  localeStatusFromProvider,
  overallStatus,
  renderBroadcast,
  type CampaignLocales,
  type CampaignLocaleState,
  type CampaignStatus
} from './broadcast';
import { buildCampaignContext, type CampaignModeHooks } from './server';

/**
 * Sending a campaign: one broadcast per language to that language's
 * audience, now or at a scheduled time, and reading the provider's status
 * back afterwards. Each step is appended to
 * `$EMAIL_TMP_DIR/logs/campaign-sends-<date>.jsonl` as well.
 */

export const CAMPAIGN_COLUMNS = 'id, name, template_id, document, status, provider, scheduled_at, sent_at, locales, recipient_count, error, created_at, updated_at';

export interface CampaignRow {
  id: string;
  name: string;
  template_id: string | null;
  document: unknown;
  status: CampaignStatus;
  provider: CampaignProviderName;
  scheduled_at: string | null;
  sent_at: string | null;
  locales: CampaignLocales;
  recipient_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The campaign provider this shop sends through — Resend or Mailchimp —
 * when a key is set for it, in the environment or in Vault. Not the same
 * question as whether receipts can be sent, which is resolveEmailConfig().
 */
export async function campaignProvider(): Promise<CampaignProviderClient | null> {
  return createCampaignProvider();
}

export interface LocaleReadiness {
  locale: string;
  subscribed: number;
  due: number;
  audienceId: string | null;
}

/** Per language: how many will get it, how many still need syncing, whether an audience exists. */
export async function campaignReadiness(
  supabase: SupabaseClient,
  locales: readonly string[],
  provider: CampaignProviderName = 'resend'
): Promise<LocaleReadiness[]> {
  const { data: audiences } = await supabase.from('email_audiences').select('locale, audience_id').eq('provider', provider);
  const byLocale = new Map((audiences ?? []).map((row) => [row.locale as string, row.audience_id as string]));
  return Promise.all(
    locales.map(async (locale) => {
      const [{ count: subscribed }, { count: due }] = await Promise.all([
        supabase.from('email_subscribers').select('id', { count: 'exact', head: true }).eq('locale', locale).eq('status', 'subscribed'),
        supabase.from('email_subscribers').select('id', { count: 'exact', head: true }).eq('locale', locale).eq('provider_sync_due', true)
      ]);
      return { locale, subscribed: subscribed ?? 0, due: due ?? 0, audienceId: byLocale.get(locale) ?? null };
    })
  );
}

async function log(entry: Record<string, unknown>) {
  try {
    await appendEmailTmpLog(`campaign-sends-${new Date().toISOString().slice(0, 10)}.jsonl`, { event: 'campaign', at: new Date().toISOString(), ...entry });
  } catch (error) {
    console.error('Could not write the campaign log:', error instanceof Error ? error.message : error);
  }
}

export interface SendCampaignOptions {
  locales: readonly string[];
  mode: CampaignModeHooks;
  /** ISO time, or null for now. */
  scheduledAt: string | null;
  shopName: string;
}

export type SendCampaignResult =
  | { ok: true; campaign: CampaignRow }
  | { ok: false; error: 'not-configured' | 'not-draft' | 'nobody' | 'audience-missing' | 'not-synced' | 'failed'; message?: string; campaign?: CampaignRow };

/**
 * Sends (or schedules) a draft. The row is claimed first, so a double
 * click sends once. A language with no confirmed subscribers is skipped;
 * one whose list is not fully synced stops the send, since people would
 * be missed.
 */
export async function sendCampaign(supabase: SupabaseClient, campaign: CampaignRow, options: SendCampaignOptions): Promise<SendCampaignResult> {
  const resend = await campaignProvider();
  const config = await resolveEmailConfig();
  if (!resend || !config.from) return { ok: false, error: 'not-configured' };

  const readiness = await campaignReadiness(supabase, options.locales, resend.name);
  const targets = readiness.filter((entry) => entry.subscribed > 0);
  if (!targets.length) return { ok: false, error: 'nobody' };
  const unsynced = targets.find((entry) => entry.due > 0 || !entry.audienceId);
  if (unsynced) return { ok: false, error: unsynced.audienceId ? 'not-synced' : 'audience-missing', message: unsynced.locale };

  const { data: claimed } = await supabase
    .from('email_campaigns')
    .update({ status: 'sending', scheduled_at: options.scheduledAt })
    .eq('id', campaign.id)
    .eq('status', 'draft')
    .select(CAMPAIGN_COLUMNS)
    .maybeSingle();
  if (!claimed) return { ok: false, error: 'not-draft' };

  const locales: CampaignLocales = {};
  for (const entry of readiness) {
    if (entry.subscribed === 0) {
      locales[entry.locale] = { broadcastId: null, recipients: 0, status: 'skipped' };
      continue;
    }
    locales[entry.locale] = await sendOne(supabase, resend, claimed as CampaignRow, entry, options, config.from, config.replyTo);
    await log({ campaignId: campaign.id, locale: entry.locale, ...locales[entry.locale], scheduledAt: options.scheduledAt });
  }

  const status = overallStatus(locales, Boolean(options.scheduledAt));
  const failed = Object.entries(locales).find(([, state]) => state.status === 'failed');
  const { data: updated } = await supabase
    .from('email_campaigns')
    .update({
      status,
      locales,
      recipient_count: Object.values(locales).reduce((sum, state) => sum + state.recipients, 0),
      error: failed ? `${failed[0]}: ${failed[1].error ?? 'failed'}`.slice(0, 1000) : null
    })
    .eq('id', campaign.id)
    .select(CAMPAIGN_COLUMNS)
    .maybeSingle();
  const row = (updated ?? claimed) as CampaignRow;
  return failed ? { ok: false, error: 'failed', message: row.error ?? undefined, campaign: row } : { ok: true, campaign: row };
}

async function sendOne(
  supabase: SupabaseClient,
  resend: CampaignProviderClient,
  campaign: CampaignRow,
  entry: LocaleReadiness,
  options: SendCampaignOptions,
  from: string,
  replyTo: string | null
): Promise<CampaignLocaleState> {
  try {
    const context = await buildCampaignContext(supabase, campaign.document, {
      locale: entry.locale,
      recipient: null,
      unsubscribeUrl: unsubscribePlaceholderFor(resend.name),
      mode: options.mode
    });
    const rendered = renderBroadcast(campaign.document, { ...context, passthroughTags: passthroughTagsFor(resend.name) });
    if (!rendered.ok) {
      return { broadcastId: null, recipients: entry.subscribed, status: 'failed', error: rendered.error, warnings: rendered.warnings };
    }
    const created = await resend.createBroadcast({
      audienceId: entry.audienceId as string,
      from,
      replyTo,
      subject: rendered.email.subject,
      previewText: rendered.email.preheader || undefined,
      html: rendered.email.html,
      text: rendered.email.text,
      name: broadcastName(campaign.name, entry.locale)
    });
    if (!created.ok) return { broadcastId: null, recipients: entry.subscribed, status: 'failed', error: created.message, warnings: rendered.email.warnings };
    const sent = await resend.sendBroadcast(created.data.id, options.scheduledAt);
    if (!sent.ok) return { broadcastId: created.data.id, recipients: entry.subscribed, status: 'failed', error: sent.message, warnings: rendered.email.warnings };
    return {
      broadcastId: created.data.id,
      recipients: entry.subscribed,
      status: options.scheduledAt ? 'scheduled' : 'queued',
      error: null,
      warnings: rendered.email.warnings
    };
  } catch (error) {
    return { broadcastId: null, recipients: entry.subscribed, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/** Asks the provider how each language's broadcast is doing and records it. */
export async function refreshCampaign(supabase: SupabaseClient, campaign: CampaignRow): Promise<CampaignRow> {
  const resend = await campaignProvider();
  if (!resend || campaign.status === 'draft') return campaign;
  const locales: CampaignLocales = { ...campaign.locales };
  for (const [locale, state] of Object.entries(locales)) {
    if (!state.broadcastId || state.status === 'sent') continue;
    const result = await resend.getBroadcast(state.broadcastId);
    if (!result.ok) continue;
    locales[locale] = { ...state, status: localeStatusFromProvider(result.data.status), error: result.data.status === 'failed' ? 'failed' : state.error };
  }
  const status = overallStatus(locales, Boolean(campaign.scheduled_at));
  const allSent = status === 'sent';
  const { data } = await supabase
    .from('email_campaigns')
    .update({ locales, status, ...(allSent && !campaign.sent_at ? { sent_at: new Date().toISOString() } : {}) })
    .eq('id', campaign.id)
    .select(CAMPAIGN_COLUMNS)
    .maybeSingle();
  return (data ?? campaign) as CampaignRow;
}
