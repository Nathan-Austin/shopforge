'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { DEFAULT_LOCALE, LOCALES } from '@/i18n/config';
import { parseSchedule } from '@/lib/email/campaigns/broadcast';
import { CAMPAIGN_COLUMNS, campaignProvider, refreshCampaign, sendCampaign, type CampaignRow } from '@/lib/email/campaigns/send';
import { cleanTemplateName, planTemplateSave } from '@/lib/email/campaigns/templates';
import { syncAudienceStep, type SyncProgress } from '@/lib/email/subscribers/sync';
import { CAMPAIGN_MODE } from '../email/mode';
import { ensureShopOwner } from '../lib/auth';

interface Context {
  locale: string;
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refresh(locale: string, id?: string) {
  revalidatePath(`/${locale}/admin/email/campaigns`);
  if (id) revalidatePath(`/${locale}/admin/email/campaigns/${id}`);
}

export type CampaignActionResult =
  | { ok: true; action: 'created' | 'deleted' | 'sent' | 'scheduled' | 'refreshed'; id: string }
  | { ok: false; error: 'not_authorized' | 'not_found' | 'name' | 'template' | 'template_invalid' | 'not_draft' | 'schedule_invalid' | 'schedule_past' | 'schedule_too_far' | 'not_configured' | 'nobody' | 'audience_missing' | 'not_synced' | 'failed'; message?: string };

/** A new draft from a template: its document is copied, so later edits to the template do not change it. */
export async function createCampaign(context: Context, _previous: CampaignActionResult | null, formData: FormData): Promise<CampaignActionResult> {
  const { error, supabase, user } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };
  const name = cleanTemplateName(formData.get('name'));
  if (!name) return { ok: false, error: 'name' };
  const templateId = formData.get('template_id')?.toString() ?? '';
  if (!ID_PATTERN.test(templateId)) return { ok: false, error: 'template' };
  const { data: template } = await supabase.from('email_templates').select('id, document').eq('id', templateId).maybeSingle();
  if (!template) return { ok: false, error: 'template' };
  // The strict check again: a template saved by an older version may no longer pass.
  const plan = planTemplateSave({ name, document: template.document });
  if (!plan.ok || !plan.document) return { ok: false, error: 'template_invalid' };

  const { data, error: insertError } = await supabase
    .from('email_campaigns')
    .insert({ name, template_id: templateId, document: plan.document, created_by: user?.id ?? null })
    .select('id')
    .single();
  if (insertError || !data) return { ok: false, error: 'failed', message: insertError?.message };
  refresh(context.locale);
  redirect(`/${context.locale}/admin/email/campaigns/${data.id}`);
}

export async function deleteCampaign(context: Context, formData: FormData): Promise<CampaignActionResult> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };
  const id = formData.get('id')?.toString() ?? '';
  if (!ID_PATTERN.test(id)) return { ok: false, error: 'not_found' };
  // Only drafts: a sent campaign is a record of what went out.
  const { data } = await supabase.from('email_campaigns').delete().eq('id', id).eq('status', 'draft').select('id').maybeSingle();
  if (!data) return { ok: false, error: 'not_draft' };
  refresh(context.locale);
  return { ok: true, action: 'deleted', id };
}

/** One sync round for a language; the page calls it again while `remaining` is above zero. */
export async function syncAudience(locale: string, forcePull: boolean): Promise<SyncProgress> {
  const refused = (error: string): SyncProgress => ({ locale, audienceId: null, pushed: 0, remaining: 0, pulledUnsubscribes: 0, rateLimited: false, error });
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return refused('not_authorized');
  if (!(LOCALES as readonly string[]).includes(locale)) return refused('not_found');
  const resend = await campaignProvider();
  if (!resend) return refused('not_configured');
  const shopName = process.env.NEXT_PUBLIC_SHOP_NAME?.trim() || 'Our shop';
  return syncAudienceStep(supabase, resend, locale, shopName, { forcePull });
}

const SEND_ERRORS: Record<string, Extract<CampaignActionResult, { ok: false }>['error']> = {
  'not-configured': 'not_configured',
  'not-draft': 'not_draft',
  nobody: 'nobody',
  'audience-missing': 'audience_missing',
  'not-synced': 'not_synced',
  failed: 'failed'
};

/** Sends now, or at the chosen time. The form sends the time as ISO 8601 (UTC). */
export async function sendCampaignAction(context: Context & { id: string }, _previous: CampaignActionResult | null, formData: FormData): Promise<CampaignActionResult> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };
  const schedule = parseSchedule(formData.get('scheduled_at'));
  if (!schedule.ok) return { ok: false, error: `schedule_${schedule.reason.replace('-', '_')}` as 'schedule_invalid' | 'schedule_past' | 'schedule_too_far' };
  const { data: row } = await supabase.from('email_campaigns').select(CAMPAIGN_COLUMNS).eq('id', context.id).maybeSingle();
  if (!row) return { ok: false, error: 'not_found' };

  const result = await sendCampaign(supabase, row as CampaignRow, {
    locales: Array.from(new Set([...(LOCALES as readonly string[]), DEFAULT_LOCALE])),
    mode: CAMPAIGN_MODE,
    scheduledAt: schedule.at,
    shopName: process.env.NEXT_PUBLIC_SHOP_NAME?.trim() || 'Our shop'
  });
  refresh(context.locale, context.id);
  if (!result.ok) return { ok: false, error: SEND_ERRORS[result.error] ?? 'failed', message: result.message };
  return { ok: true, action: schedule.at ? 'scheduled' : 'sent', id: context.id };
}

export async function refreshCampaignAction(context: Context, formData: FormData): Promise<CampaignActionResult> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };
  const id = formData.get('id')?.toString() ?? '';
  const { data: row } = ID_PATTERN.test(id) ? await supabase.from('email_campaigns').select(CAMPAIGN_COLUMNS).eq('id', id).maybeSingle() : { data: null };
  if (!row) return { ok: false, error: 'not_found' };
  await refreshCampaign(supabase, row as CampaignRow);
  refresh(context.locale, id);
  return { ok: true, action: 'refreshed', id };
}
