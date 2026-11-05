/**
 * From database rows to what the renderer needs: products as a product
 * block shows them, live discount codes with their wording, and the sample
 * subscriber a preview or test send uses.
 *
 * Pure, so the rules (which codes count as live, which product link a
 * German reader gets) are tested without a database.
 */

import { discountStatus, type DiscountCode } from '../../discounts/rules';
import { formatPrice } from '../../format';
import { MERGE_TAGS, type MergeValues } from './mergeTags';
import type { CampaignDiscount, CampaignProduct, CampaignRenderContext, CampaignStrings } from './render';

/** The products_public columns a product block reads. */
export const CAMPAIGN_PRODUCT_COLUMNS = 'id, name, slug, price_cents, compare_at_price_cents, currency, image_url';

export interface CampaignProductRow {
  id: string;
  name: string;
  slug: string;
  price_cents: number;
  compare_at_price_cents: number | null;
  currency: string | null;
  image_url: string | null;
}

/** A product as the designer holds it: no locale yet, extra lines worked out. */
export interface CatalogProduct {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  currency: string;
  imageUrl: string | null;
  extras: string[];
}

export function toCatalogProduct(row: CampaignProductRow, extras: string[] = []): CatalogProduct {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    priceCents: row.price_cents,
    compareAtPriceCents: row.compare_at_price_cents,
    currency: row.currency || 'EUR',
    imageUrl: row.image_url,
    extras: extras.filter((line) => line.trim())
  };
}

/**
 * A product for the recipient's locale: the link goes to its page in
 * their language. Null without a site URL, since an email cannot link to
 * a relative path.
 */
export function catalogToCampaignProduct(product: CatalogProduct, locale: string, siteUrl: string | null): CampaignProduct | null {
  const base = siteUrl?.replace(/\/$/, '');
  if (!base) return null;
  return {
    id: product.id,
    name: product.name,
    url: `${base}/${locale}/shop/${encodeURIComponent(product.slug)}`,
    priceCents: product.priceCents,
    compareAtPriceCents: product.compareAtPriceCents,
    currency: product.currency,
    imageUrl: product.imageUrl,
    extras: product.extras
  };
}

export function toCampaignProduct(
  row: CampaignProductRow,
  options: { locale: string; siteUrl: string | null; extras?: string[] }
): CampaignProduct | null {
  return catalogToCampaignProduct(toCatalogProduct(row, options.extras), options.locale, options.siteUrl);
}

/** How a code's value reads, from `Email.campaign`. */
export interface DiscountWording {
  percent: (percent: string) => string;
  amount: (amount: string) => string;
  freeShipping: string;
}

export function describeDiscount(code: DiscountCode, wording: DiscountWording, locale: string): string {
  switch (code.kind) {
    case 'percent':
      return wording.percent(new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(code.percentOff ?? 0));
    case 'amount':
      return wording.amount(formatPrice(code.amountOffCents ?? 0, code.currency ?? 'EUR', locale));
    case 'free_shipping':
      return wording.freeShipping;
  }
}

/**
 * The codes a campaign may show: active right now, or scheduled to start
 * later (a campaign often announces a sale before it opens). Retired,
 * expired and used-up codes are left out, and the renderer drops their
 * blocks with a warning.
 */
export function campaignDiscounts(
  codes: DiscountCode[],
  wording: DiscountWording,
  locale: string,
  now: Date = new Date()
): Record<string, CampaignDiscount> {
  const out: Record<string, CampaignDiscount> = {};
  for (const code of codes) {
    const status = discountStatus(code, now);
    if (status === 'active' || status === 'scheduled') {
      out[code.code] = { code: code.code, label: describeDiscount(code, wording, locale) };
    }
  }
  return out;
}

/**
 * Until subscribers exist (roadmap phase D) previews and tests have no
 * real unsubscribe link; they point at the shop's home page in that
 * language, so the footer looks as it will.
 */
export function previewUnsubscribeUrl(siteUrl: string | null, locale: string): string | null {
  const base = siteUrl?.replace(/\/$/, '');
  return base ? `${base}/${locale}` : null;
}

/**
 * The made-up subscriber of a preview and a test send, so merge tags show
 * something real. Only subscriber values: the shop's own values come from
 * the shop.
 */
export function sampleSubscriberValues(): MergeValues {
  return {
    'subscriber.first_name': MERGE_TAGS['subscriber.first_name'].sample,
    'subscriber.email': MERGE_TAGS['subscriber.email'].sample
  };
}

// --- The designer's live preview -----------------------------------------------

/** The fixed wording and code labels for one language. */
export interface DesignerLocaleData {
  strings: CampaignStrings;
  /** Code -> "15% off" in this language, for live and scheduled codes. */
  discountLabels: Record<string, string>;
}

export interface DesignerDiscount {
  code: string;
  status: 'active' | 'scheduled';
}

/**
 * Everything the designer needs to render in the browser, loaded once by
 * the page: the preview then updates on every keystroke without asking
 * the server.
 */
export interface DesignerData {
  shop: { name: string; url: string | null };
  catalog: CatalogProduct[];
  discounts: DesignerDiscount[];
  locales: Record<string, DesignerLocaleData>;
}

/**
 * The render context for a preview in one language: the same sample
 * subscriber and placeholder unsubscribe link as a server preview or a
 * test send, so what the owner sees is what a test looks like.
 */
export function designerPreviewContext(data: DesignerData, locale: string, fallbackLocale: string): CampaignRenderContext {
  const localeData = data.locales[locale] ?? data.locales[fallbackLocale] ?? Object.values(data.locales)[0];
  const products: Record<string, CampaignProduct> = {};
  for (const product of data.catalog) {
    const campaignProduct = catalogToCampaignProduct(product, locale, data.shop.url);
    if (campaignProduct) products[product.id] = campaignProduct;
  }
  const discounts: Record<string, CampaignDiscount> = {};
  for (const discount of data.discounts) {
    discounts[discount.code] = { code: discount.code, label: localeData?.discountLabels[discount.code] ?? discount.code };
  }
  return {
    locale,
    strings: localeData?.strings ?? {
      footerReason: '',
      unsubscribe: 'Unsubscribe',
      viewProduct: 'View product',
      discountTitle: '',
      discountHint: ''
    },
    shop: data.shop,
    recipient: null,
    unsubscribeUrl: previewUnsubscribeUrl(data.shop.url, locale),
    products,
    discounts,
    mergeValues: sampleSubscriberValues()
  };
}
