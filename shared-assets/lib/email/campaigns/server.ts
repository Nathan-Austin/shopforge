import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getTranslations } from 'next-intl/server';

import { CODE_PATTERN, discountStatus } from '@/lib/discounts/rules';
import { DISCOUNT_COLUMNS, toDiscountCode, type DiscountRow } from '@/lib/discounts/service';
import { resolveEmailConfig } from '@/lib/email/config';
import { sendEmail } from '@/lib/email/send';
import { appendEmailTmpLog } from '@/lib/email/tmpDir';
import {
  CAMPAIGN_PRODUCT_COLUMNS,
  campaignDiscounts,
  previewUnsubscribeUrl,
  sampleSubscriberValues,
  toCampaignProduct,
  toCatalogProduct,
  type CampaignProductRow,
  type CatalogProduct,
  type DesignerData,
  type DesignerLocaleData,
  type DiscountWording
} from './context';
import type { MergeValues } from './mergeTags';
import { campaignStrings, renderCampaign, type CampaignProduct, type CampaignRenderContext } from './render';
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
    discountWording(t),
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

type Translate = (key: string, values?: Record<string, string>) => string;

function discountWording(t: Translate): DiscountWording {
  return {
    percent: (percent) => t('discountPercent', { percent }),
    amount: (amount) => t('discountAmount', { amount }),
    freeShipping: t('discountFreeShipping')
  };
}

/** How many products the designer's picker shows before the owner searches. */
export const CATALOG_PAGE = 24;

function catalogRows(rows: unknown, mode: CampaignModeHooks): CatalogProduct[] {
  return ((rows ?? []) as (CampaignProductRow & Record<string, unknown>)[]).map((row) =>
    toCatalogProduct(row, mode.productExtras(row))
  );
}

/**
 * What the designer renders its live preview from: the products the
 * document uses plus a first page for the picker, the codes that are live
 * or scheduled, and the fixed wording and code labels in every language.
 */
export async function loadDesignerData(
  supabase: SupabaseClient,
  document: unknown,
  locales: readonly string[],
  mode: CampaignModeHooks
): Promise<DesignerData> {
  const shop = shopSettings();
  const ids = documentReferences(document).productIds.filter((id) => ID_PATTERN.test(id));
  const columns = CAMPAIGN_PRODUCT_COLUMNS + mode.productColumns;
  const [used, firstPage, codes] = await Promise.all([
    ids.length ? supabase.from('products_public').select(columns).in('id', ids) : Promise.resolve({ data: [], error: null }),
    supabase.from('products_public').select(columns).order('name').limit(CATALOG_PAGE),
    supabase.from('discount_codes').select(DISCOUNT_COLUMNS).order('code')
  ]);

  const catalog = new Map<string, CatalogProduct>();
  for (const product of [...catalogRows(used.data, mode), ...catalogRows(firstPage.data, mode)]) catalog.set(product.id, product);

  const now = new Date();
  const liveCodes = ((codes.data ?? []) as DiscountRow[]).map(toDiscountCode).filter((code) => {
    const status = discountStatus(code, now);
    return status === 'active' || status === 'scheduled';
  });

  const localeData: Record<string, DesignerLocaleData> = {};
  await Promise.all(
    locales.map(async (locale) => {
      const t = await getTranslations({ locale, namespace: 'Email.campaign' });
      const labels = campaignDiscounts(liveCodes, discountWording(t), locale, now);
      localeData[locale] = {
        strings: campaignStrings(t, shop.name),
        discountLabels: Object.fromEntries(Object.values(labels).map((discount) => [discount.code, discount.label]))
      };
    })
  );

  return {
    shop,
    catalog: [...catalog.values()],
    discounts: liveCodes.map((code) => ({ code: code.code, status: discountStatus(code, now) as 'active' | 'scheduled' })),
    locales: localeData
  };
}

/** Published products whose name contains the query, for the picker. */
export async function searchCatalog(supabase: SupabaseClient, query: string, mode: CampaignModeHooks): Promise<CatalogProduct[]> {
  // ilike treats % and _ as wildcards and \ as their escape.
  const pattern = `%${query.trim().slice(0, 80).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const { data } = await supabase
    .from('products_public')
    .select(CAMPAIGN_PRODUCT_COLUMNS + mode.productColumns)
    .ilike('name', pattern)
    .order('name')
    .limit(CATALOG_PAGE);
  return catalogRows(data, mode);
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
    unsubscribeUrl: previewUnsubscribeUrl(shopSettings().url, request.locale),
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
  if ((await resolveEmailConfig()).provider === 'none') return { ...withSubject, status: 'not-configured' };

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
