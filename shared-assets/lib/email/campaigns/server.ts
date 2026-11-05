import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getTranslations } from 'next-intl/server';

import { CODE_PATTERN } from '@/lib/discounts/rules';
import { DISCOUNT_COLUMNS, toDiscountCode, type DiscountRow } from '@/lib/discounts/service';
import { getEmailConfig } from '@/lib/email/config';
import { sendEmail } from '@/lib/email/send';
import { appendEmailTmpLog } from '@/lib/email/tmpDir';
import {
  CAMPAIGN_PRODUCT_COLUMNS,
  campaignDiscounts,
  sampleSubscriberValues,
  toCampaignProduct,
  type CampaignProductRow
} from './context';
import type { MergeValues } from './mergeTags';
import {
  campaignStrings,
  renderCampaign,
  type CampaignProduct,
  type CampaignRenderContext,
  type CampaignRenderResult
} from './render';
import { documentReferences, type EmailTemplate } from './templates';
import { maskEmail, testSendLogEntry, testSendLogFile, type TestSendResult } from './testSendLog';

/**
 * Campaign rendering and test sends against the shop's data.
 *
 * Runs with the caller's Supabase client, which in the admin is the
 * owner's session: products come from products_public (published only)
 * and discount codes through the owner's RLS.
 */

/** What differs between store modes; each mode's admin passes its own. */
export interface CampaignModeHooks {
  /** Extra products_public columns, starting with a comma (`, heat_level`). */
  productColumns: string;
  /** Lines under a product's name, e.g. a chilli shop's heat. */
  productExtras: (row: Record<string, unknown>) => string[];
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shopSettings() {
  return {
    name: process.env.NEXT_PUBLIC_SHOP_NAME?.trim() || 'Our shop',
    url: process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '') || null
  };
}

export interface CampaignContextOptions {
  locale: string;
  recipient: CampaignRenderContext['recipient'];
  mergeValues?: MergeValues;
  unsubscribeUrl: string | null;
  mode: CampaignModeHooks;
}

/**
 * Everything renderCampaign needs for one locale. Product and code
 * lookups that fail leave those blocks out (with a warning from the
 * renderer) rather than failing the whole email.
 */
export async function buildCampaignContext(
  supabase: SupabaseClient,
  document: unknown,
  options: CampaignContextOptions
): Promise<CampaignRenderContext> {
  const shop = shopSettings();
  const { productIds, discountCodes } = documentReferences(document);
  // The document is read unvalidated; never hand PostgREST a malformed id.
  const ids = productIds.filter((id) => ID_PATTERN.test(id));
  const codes = discountCodes.filter((code) => CODE_PATTERN.test(code));

  const [productsResult, discountsResult, t] = await Promise.all([
    ids.length
      ? supabase.from('products_public').select(CAMPAIGN_PRODUCT_COLUMNS + options.mode.productColumns).in('id', ids)
      : Promise.resolve({ data: [], error: null }),
    codes.length
      ? supabase.from('discount_codes').select(DISCOUNT_COLUMNS).in('code', codes)
      : Promise.resolve({ data: [], error: null }),
    getTranslations({ locale: options.locale, namespace: 'Email.campaign' })
  ]);

  const products: Record<string, CampaignProduct> = {};
  for (const row of (productsResult.data ?? []) as unknown as (CampaignProductRow & Record<string, unknown>)[]) {
    const product = toCampaignProduct(row, {
      locale: options.locale,
      siteUrl: shop.url,
      extras: options.mode.productExtras(row)
    });
    if (product) products[row.id] = product;
  }

  const discounts = campaignDiscounts(
    ((discountsResult.data ?? []) as DiscountRow[]).map(toDiscountCode),
    {
      percent: (percent) => t('discountPercent', { percent }),
      amount: (amount) => t('discountAmount', { amount }),
      freeShipping: t('discountFreeShipping')
    },
    options.locale
  );

  return {
    locale: options.locale,
    strings: campaignStrings(t, shop.name),
    shop,
    recipient: options.recipient,
    unsubscribeUrl: options.unsubscribeUrl,
    products,
    discounts,
    mergeValues: options.mergeValues
  };
}

/**
 * Until subscribers exist (roadmap phase D) previews and tests have no
 * real unsubscribe link; they point at the shop's home page in that
 * language, so the footer looks as it will.
 */
function placeholderUnsubscribeUrl(locale: string): string | null {
  const url = shopSettings().url;
  return url ? `${url}/${locale}` : null;
}

/** The designer's and the admin's preview: a sample subscriber, nothing sent. */
export async function renderCampaignPreview(
  supabase: SupabaseClient,
  document: unknown,
  locale: string,
  mode: CampaignModeHooks
): Promise<CampaignRenderResult> {
  const context = await buildCampaignContext(supabase, document, {
    locale,
    recipient: null,
    mergeValues: sampleSubscriberValues(),
    unsubscribeUrl: placeholderUnsubscribeUrl(locale),
    mode
  });
  return renderCampaign(document, context);
}

export interface TestSendRequest {
  template: EmailTemplate;
  /** Already validated as one email address. */
  to: string;
  locale: string;
  /** "[Test]", in the admin's language. */
  subjectPrefix: string;
  mode: CampaignModeHooks;
}

/**
 * Renders the template for one locale and sends it to one address through
 * the transactional provider. Campaigns to subscribers never come this way
 * (roadmap phase E). The result is returned and appended to the day's log
 * in `$EMAIL_TMP_DIR/logs/`; a log that cannot be written is reported in
 * the result, never fails the send.
 */
export async function sendCampaignTest(supabase: SupabaseClient, request: TestSendRequest): Promise<TestSendResult> {
  const started = new Date();
  const base: TestSendResult = {
    ok: false,
    status: 'failed',
    at: started.toISOString(),
    templateId: request.template.id,
    locale: request.locale,
    to: maskEmail(request.to),
    provider: 'resend',
    warnings: [],
    log: { file: null }
  };

  let result: TestSendResult;
  try {
    result = await renderAndSend(supabase, request, base, started);
  } catch (error) {
    result = { ...base, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' };
  }

  try {
    const file = await appendEmailTmpLog(testSendLogFile(started), testSendLogEntry(result));
    return { ...result, log: { file } };
  } catch (error) {
    return { ...result, log: { file: null, error: error instanceof Error ? error.message : 'Unknown error' } };
  }
}

async function renderAndSend(
  supabase: SupabaseClient,
  request: TestSendRequest,
  base: TestSendResult,
  started: Date
): Promise<TestSendResult> {
  const context = await buildCampaignContext(supabase, request.template.document, {
    locale: request.locale,
    recipient: { email: request.to, firstName: null },
    // The sample first name, so {{subscriber.first_name}} shows working.
    mergeValues: { 'subscriber.first_name': sampleSubscriberValues()['subscriber.first_name'] },
    unsubscribeUrl: placeholderUnsubscribeUrl(request.locale),
    mode: request.mode
  });
  const rendered = renderCampaign(request.template.document, context);
  if (!rendered.ok) {
    return {
      ...base,
      status: rendered.error === 'empty' ? 'empty' : 'invalid-template',
      warnings: rendered.warnings,
      issues: rendered.issues
    };
  }

  const { email } = rendered;
  const subject = `${request.subjectPrefix} ${email.subject}`.trim();
  const withSubject = { ...base, subject, warnings: email.warnings };
  if (getEmailConfig().provider === 'none') return { ...withSubject, status: 'not-configured' };

  const sent = await sendEmail({ to: request.to, subject, html: email.html, text: email.text });
  const durationMs = Date.now() - started.getTime();
  if (sent.sent) return { ...withSubject, ok: true, status: 'sent', messageId: sent.id, durationMs };
  return {
    ...withSubject,
    status: sent.reason === 'not-configured' ? 'not-configured' : 'provider-error',
    error: sent.error,
    durationMs
  };
}
