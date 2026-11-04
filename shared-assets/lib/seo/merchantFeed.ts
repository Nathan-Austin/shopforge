/**
 * Google Merchant Center product feed (RSS 2.0 with the g: namespace).
 *
 * One feed per locale, built from the same product rows and currency the
 * pages show, so Merchant Center's price check against the landing page
 * passes. Pure: rows in, XML out. The route around it refuses to publish
 * an empty feed when the catalogue cannot be read, because Merchant Center
 * deletes every product that disappears from its source.
 *
 * Spec: support.google.com/merchants/answer/14987622 (RSS 2.0) and
 * support.google.com/merchants/answer/7052112 (attributes).
 */

import { gtinProperty, priceString, type Availability } from './jsonld';

export interface FeedProduct {
  id: string;
  title: string;
  description: string | null;
  /** Absolute landing page URL in this locale. */
  link: string;
  /** Absolute image URLs, main first. */
  images: string[];
  priceCents: number;
  /** ISO 4217. */
  currency: string;
  availability: Availability;
  brand?: string | null;
  sku?: string | null;
  barcode?: string | null;
  category?: string | null;
  shippingWeightGrams?: number | null;
}

export interface FeedInput {
  shopName: string;
  /** Absolute URL of the shop's home page in this locale. */
  shopUrl: string;
  /** Short description of the shop for the channel element. */
  shopDescription?: string | null;
  products: FeedProduct[];
}

const AVAILABILITY: Record<Availability, string> = {
  InStock: 'in_stock',
  OutOfStock: 'out_of_stock',
  BackOrder: 'backorder',
  PreOrder: 'preorder'
};

/** XML text: the five characters that can break an element or attribute. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function element(name: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

/** Google caps titles at 150 and descriptions at 5000 characters. */
function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function feedItem(product: FeedProduct): string {
  const gtin = Object.values(gtinProperty(product.barcode))[0] ?? null;
  const [image, ...more] = product.images;
  const parts = [
    element('g:id', product.id),
    element('g:title', clip(product.title, 150)),
    element('g:description', clip(product.description || product.title, 5000)),
    element('g:link', product.link),
    element('g:image_link', image ?? null),
    ...more.slice(0, 10).map((url) => element('g:additional_image_link', url)),
    element('g:availability', AVAILABILITY[product.availability]),
    element('g:price', `${priceString(product.priceCents)} ${product.currency.toUpperCase()}`),
    element('g:condition', 'new'),
    element('g:brand', product.brand?.trim() || null),
    element('g:gtin', gtin),
    element('g:mpn', product.sku?.trim() || null),
    // Without any identifier Google needs to be told, or it assumes an
    // omission and may limit the listing.
    !gtin && !product.sku?.trim() ? element('g:identifier_exists', 'no') : '',
    element('g:product_type', product.category?.trim() || null),
    product.shippingWeightGrams && product.shippingWeightGrams > 0
      ? element('g:shipping_weight', `${product.shippingWeightGrams} g`)
      : ''
  ].filter(Boolean);
  return `<item>${parts.join('')}</item>`;
}

export function buildMerchantFeed(input: FeedInput): string {
  const items = input.products.map(feedItem).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
${element('title', input.shopName)}
${element('link', input.shopUrl)}
${element('description', input.shopDescription || input.shopName)}
${items}
</channel>
</rss>
`;
}
