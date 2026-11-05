'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';

import { DEFAULT_LOCALE, LOCALES } from '@/i18n/config';
import type { CampaignIssue } from '@/lib/email/campaigns/schema';
import { sendCampaignTest } from '@/lib/email/campaigns/server';
import {
  buildStarterDocument,
  duplicateName,
  planTemplateSave,
  TEMPLATE_COLUMNS,
  toEmailTemplate,
  type EmailTemplateRow,
  type TemplateSaveError
} from '@/lib/email/campaigns/templates';
import { maskEmail, type TestSendResult, type TestSendStatus } from '@/lib/email/campaigns/testSendLog';
import { CAMPAIGN_MODE, STARTER_KEYS, STARTERS, type StarterKey } from '../email/mode';
import { ensureShopOwner } from '../lib/auth';

export type EmailTemplateActionError = TemplateSaveError | 'starter' | 'not_found' | 'not_authorized' | 'failed';

export type EmailTemplateActionResult =
  | { ok: true; action: 'created' | 'saved' | 'duplicated' | 'deleted'; id: string; name: string }
  | { ok: false; error: EmailTemplateActionError; issues?: CampaignIssue[]; message?: string };

interface EmailContext {
  locale: string;
}

/** A second test of the same template within this window is refused. */
const TEST_SEND_COOLDOWN_MS = 10_000;

function refresh(locale: string, id?: string) {
  revalidatePath(`/${locale}/admin/email`);
  if (id) revalidatePath(`/${locale}/admin/email/${id}`);
}

/** Creates a template from a starter layout and opens it. */
export async function createEmailTemplate(
  context: EmailContext,
  _previous: EmailTemplateActionResult | null,
  formData: FormData
): Promise<EmailTemplateActionResult> {
  const { error, supabase, user } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const starter = formData.get('starter')?.toString() as StarterKey;
  if (!STARTER_KEYS.includes(starter)) return { ok: false, error: 'starter' };

  const plan = planTemplateSave({
    name: formData.get('name'),
    document: buildStarterDocument(STARTERS[starter], LOCALES, DEFAULT_LOCALE)
  });
  if (!plan.ok) return { ok: false, error: plan.error, issues: plan.issues };

  const { data, error: insertError } = await supabase
    .from('email_templates')
    .insert({ name: plan.name, document: plan.document, created_by: user?.id ?? null })
    .select('id')
    .single();
  if (insertError || !data) return { ok: false, error: 'failed', message: insertError?.message };

  refresh(context.locale);
  redirect(`/${context.locale}/admin/email/${data.id}?notice=created`);
}

/**
 * Renames a template and, when a document is sent along (the designer
 * does), replaces it. Either way the document is checked in full first.
 */
export async function saveEmailTemplate(
  context: EmailContext & { id: string },
  _previous: EmailTemplateActionResult | null,
  formData: FormData
): Promise<EmailTemplateActionResult> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const plan = planTemplateSave({ name: formData.get('name'), document: formData.get('document') ?? undefined });
  if (!plan.ok) return { ok: false, error: plan.error, issues: plan.issues };

  const { data, error: updateError } = await supabase
    .from('email_templates')
    .update(plan.document ? { name: plan.name, document: plan.document } : { name: plan.name })
    .eq('id', context.id)
    .select('id')
    .maybeSingle();
  if (updateError) return { ok: false, error: 'failed', message: updateError.message };
  if (!data) return { ok: false, error: 'not_found' };

  refresh(context.locale, context.id);
  return { ok: true, action: 'saved', id: context.id, name: plan.name };
}

export async function duplicateEmailTemplate(context: EmailContext, formData: FormData): Promise<EmailTemplateActionResult> {
  const { error, supabase, user } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const id = formData.get('id')?.toString() ?? '';
  const { data: row } = await supabase.from('email_templates').select('name, document').eq('id', id).maybeSingle();
  if (!row) return { ok: false, error: 'not_found' };

  const t = await getTranslations({ locale: context.locale, namespace: 'Admin.email' });
  const name = duplicateName(row.name, t('copySuffix'));
  const { data, error: insertError } = await supabase
    .from('email_templates')
    .insert({ name, document: row.document, created_by: user?.id ?? null })
    .select('id')
    .single();
  if (insertError || !data) return { ok: false, error: 'failed', message: insertError?.message };

  refresh(context.locale);
  return { ok: true, action: 'duplicated', id: data.id, name };
}

export async function deleteEmailTemplate(context: EmailContext, formData: FormData): Promise<EmailTemplateActionResult> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const id = formData.get('id')?.toString() ?? '';
  const { data, error: deleteError } = await supabase.from('email_templates').delete().eq('id', id).select('id, name').maybeSingle();
  if (deleteError) return { ok: false, error: 'failed', message: deleteError.message };
  if (!data) return { ok: false, error: 'not_found' };

  refresh(context.locale);
  return { ok: true, action: 'deleted', id, name: data.name };
}

const recipientSchema = z.email();

/**
 * Sends the template to one address, as a test. The template row is
 * claimed first (last_test_sent_at, with a short cooldown), so a double
 * click or a retrying browser sends one email, not two.
 */
export async function sendTestEmail(
  context: EmailContext & { id: string },
  _previous: TestSendResult | null,
  formData: FormData
): Promise<TestSendResult> {
  const to = formData.get('to')?.toString().trim() ?? '';
  const locale = formData.get('locale')?.toString() ?? '';
  const refused = (status: TestSendStatus): TestSendResult => ({
    ok: false,
    status,
    at: new Date().toISOString(),
    templateId: context.id,
    locale,
    to: maskEmail(to),
    provider: 'resend',
    warnings: [],
    log: { file: null }
  });

  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return refused('not-authorized');
  if (!recipientSchema.safeParse(to).success) return refused('invalid-recipient');
  if (!(LOCALES as readonly string[]).includes(locale)) return refused('invalid-locale');

  const now = new Date();
  const cutoff = new Date(now.getTime() - TEST_SEND_COOLDOWN_MS).toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from('email_templates')
    .update({ last_test_sent_at: now.toISOString() })
    .eq('id', context.id)
    // Quoted: the timestamp's ':' and '.' are reserved in PostgREST filters.
    .or(`last_test_sent_at.is.null,last_test_sent_at.lt."${cutoff}"`)
    .select(TEMPLATE_COLUMNS)
    .maybeSingle();
  if (claimError) return { ...refused('failed'), error: claimError.message };
  if (!claimed) {
    const { data: exists } = await supabase.from('email_templates').select('id').eq('id', context.id).maybeSingle();
    return refused(exists ? 'too-soon' : 'not-found');
  }

  const t = await getTranslations({ locale: context.locale, namespace: 'Admin.email.test' });
  const result = await sendCampaignTest(supabase, {
    template: toEmailTemplate(claimed as EmailTemplateRow),
    to,
    locale,
    subjectPrefix: t('subjectPrefix'),
    mode: CAMPAIGN_MODE
  });
  refresh(context.locale, context.id);
  return result;
}
