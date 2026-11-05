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
import type { CampaignDiscount, CampaignProduct } from './render';

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

/**
 * A product for the recipient's locale: the link goes to its page in
 * their language. Null without a site URL, since an email cannot link to
 * a relative path.
 */
export function toCampaignProduct(
  row: CampaignProductRow,
  options: { locale: string; siteUrl: string | null; extras?: string[] }
): CampaignProduct | null {
  const siteUrl = options.siteUrl?.replace(/\/$/, '');
  if (!siteUrl) return null;
  return {
    id: row.id,
    name: row.name,
    url: `${siteUrl}/${options.locale}/shop/${encodeURIComponent(row.slug)}`,
    priceCents: row.price_cents,
    compareAtPriceCents: row.compare_at_price_cents,
    currency: row.currency || 'EUR',
    imageUrl: row.image_url,
    extras: options.extras?.filter((line) => line.trim()) ?? []
  };
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
