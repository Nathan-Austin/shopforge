/**
 * A campaign as broadcasts: one per language, each rendered once for that
 * language's audience with the provider filling in names and unsubscribe
 * links per recipient. Pure; the send module does the talking.
 */

import { RESEND_PASSTHROUGH_TAGS, RESEND_UNSUBSCRIBE_PLACEHOLDER } from '../providers/resend';
import { renderCampaign, type CampaignRenderContext, type CampaignWarning, type RenderedCampaign } from './render';
import type { CampaignIssue } from './schema';

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';

/** What a campaign row keeps per language. */
export interface CampaignLocaleState {
  broadcastId: string | null;
  recipients: number;
  status: 'pending' | 'queued' | 'scheduled' | 'sent' | 'failed' | 'skipped';
  error?: string | null;
  warnings?: CampaignWarning[];
}

export type CampaignLocales = Record<string, CampaignLocaleState>;

export type BroadcastRender =
  | { ok: true; email: RenderedCampaign }
  | { ok: false; error: 'invalid-document' | 'empty'; issues: CampaignIssue[]; warnings: CampaignWarning[] };

/** The render context for one language's broadcast: no recipient, provider placeholders. */
export function broadcastContext(base: Omit<CampaignRenderContext, 'recipient' | 'unsubscribeUrl' | 'mergeValues' | 'passthroughTags'>): CampaignRenderContext {
  return {
    ...base,
    recipient: null,
    unsubscribeUrl: RESEND_UNSUBSCRIBE_PLACEHOLDER,
    passthroughTags: RESEND_PASSTHROUGH_TAGS
  };
}

export function renderBroadcast(document: unknown, context: CampaignRenderContext): BroadcastRender {
  const result = renderCampaign(document, context);
  if (!result.ok) return result;
  return { ok: true, email: result.email };
}

/** "Spring sale (de)": the broadcast's name in the provider's dashboard. */
export function broadcastName(campaignName: string, locale: string): string {
  return `${campaignName.slice(0, 100)} (${locale})`;
}

/** The campaign's overall status from its languages'. */
export function overallStatus(locales: CampaignLocales, scheduled: boolean): CampaignStatus {
  const states = Object.values(locales).filter((state) => state.status !== 'skipped');
  if (!states.length) return 'draft';
  if (states.some((state) => state.status === 'pending')) return 'sending';
  if (states.some((state) => state.status === 'failed')) return 'failed';
  if (states.every((state) => state.status === 'sent')) return 'sent';
  return scheduled ? 'scheduled' : 'sending';
}

/** Resend's broadcast status as ours. */
export function localeStatusFromProvider(status: string): CampaignLocaleState['status'] {
  switch (status) {
    case 'sent':
      return 'sent';
    case 'scheduled':
      return 'scheduled';
    case 'queued':
    case 'draft':
      return 'queued';
    case 'canceled':
    case 'cancelled':
    case 'failed':
      return 'failed';
    default:
      return 'queued';
  }
}

/**
 * A schedule from the form: empty means now; otherwise a time at least a
 * few minutes ahead and at most 30 days out (Resend's own limit).
 */
export function parseSchedule(input: unknown, now: Date = new Date()): { ok: true; at: string | null } | { ok: false; reason: 'invalid' | 'past' | 'too-far' } {
  if (typeof input !== 'string' || !input.trim()) return { ok: true, at: null };
  const time = Date.parse(input);
  if (!Number.isFinite(time)) return { ok: false, reason: 'invalid' };
  if (time < now.getTime() + 5 * 60 * 1000) return { ok: false, reason: 'past' };
  if (time > now.getTime() + 30 * 24 * 60 * 60 * 1000) return { ok: false, reason: 'too-far' };
  return { ok: true, at: new Date(time).toISOString() };
}
