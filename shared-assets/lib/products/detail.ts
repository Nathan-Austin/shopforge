/**
 * Product page view helpers.
 *
 * Pure functions that turn a `products_public` row into what the product
 * page shows: a stock message, the gallery list, and formatted measures.
 * No database and no React here, so every rule is unit-tested directly and
 * the page itself stays a thin layout.
 */

import { maxAllowedQuantity, type StockRules } from '@/lib/cart/pricing';
import { NUTRITION_KEYS } from './catalogue';

/**
 * A row of the `products_public` view. Every column the storefront may
 * read; the view already hides supplier fields and unpublished rows.
 * `heat_level` and `scoville_shu` only exist in chilli shops.
 */
export interface ProductDetailRow {
  id: string;
  name: string;
  slug: string;
  headline: string | null;
  description: string | null;
  details: string | null;
  image_url: string | null;
  gallery_urls: string[] | null;
  video_url: string | null;
  price_cents: number;
  compare_at_price_cents: number | null;
  currency: string;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  brand_id: string | null;
  brand_name: string | null;
  brand_slug: string | null;
  stock: number | null;
  track_inventory: boolean | null;
  allow_backorder: boolean | null;
  max_order_quantity: number | null;
  size_options: string[] | null;
  color_options: string[] | null;
  net_content: number | string | null;
  net_content_unit: string | null;
  weight_grams: number | null;
  dimensions_mm: Record<string, number> | null;
  ingredients: string | null;
  allergens: string[] | null;
  nutrition_info: Record<string, number> | null;
  dietary_flags: string[] | null;
  storage_instructions: string | null;
  best_before_text: string | null;
  tags: string[] | null;
  country_of_origin: string | null;
  meta_title: string | null;
  meta_description: string | null;
  is_featured: boolean | null;
  heat_level?: number | null;
  scoville_shu?: number | null;
}

/** Stock rules for the cart helpers, read straight off the row. */
export function stockRulesOf(row: {
  stock: number | null;
  track_inventory: boolean | null;
  allow_backorder: boolean | null;
  max_order_quantity: number | null;
}): StockRules {
  return {
    stock: row.stock,
    trackInventory: row.track_inventory,
    allowBackorder: row.allow_backorder,
    maxOrderQuantity: row.max_order_quantity
  };
}

export type StockStatus =
  /** Plenty, or the shop does not track stock at all. */
  | { kind: 'in_stock' }
  /** Tracked and running low: say how many are left. */
  | { kind: 'low_stock'; remaining: number }
  /** None on hand but the shop accepts backorders. */
  | { kind: 'backorder' }
  /** None on hand and no backorders: cannot be bought. */
  | { kind: 'sold_out' };

/** At or below this many units a tracked product reads as "only N left". */
export const LOW_STOCK_THRESHOLD = 5;

/**
 * What to tell the customer about availability. The per-order maximum is
 * deliberately not part of this: it limits a basket, not the product.
 */
export function stockStatus(
  rules: StockRules,
  lowStockThreshold = LOW_STOCK_THRESHOLD
): StockStatus {
  if (rules.trackInventory !== true) return { kind: 'in_stock' };

  const onHand = Math.max(0, Math.floor(rules.stock ?? 0));
  if (onHand <= 0) {
    return rules.allowBackorder === true ? { kind: 'backorder' } : { kind: 'sold_out' };
  }
  if (onHand <= lowStockThreshold) {
    return { kind: 'low_stock', remaining: onHand };
  }
  return { kind: 'in_stock' };
}

/**
 * Upper bound for the quantity picker, or null when there is none. Zero
 * means the product cannot be added at all.
 */
export function quantityLimit(rules: StockRules): number | null {
  const max = maxAllowedQuantity(rules);
  return Number.isFinite(max) ? max : null;
}

/**
 * Images for the gallery: the main image first, then the extra ones, with
 * blanks and repeats dropped so a product never shows the same photo twice.
 */
export function galleryImages(
  imageUrl: string | null | undefined,
  galleryUrls: readonly (string | null | undefined)[] | null | undefined
): string[] {
  const seen = new Set<string>();
  const images: string[] = [];
  for (const candidate of [imageUrl, ...(galleryUrls ?? [])]) {
    const url = candidate?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    images.push(url);
  }
  return images;
}

function formatNumber(value: number, locale: string, maximumFractionDigits = 2): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
  } catch {
    return String(value);
  }
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * "250 ml", "1.5 kg". Numeric columns come back from PostgREST as strings,
 * so the amount is parsed first. Returns null when there is nothing to show.
 */
export function formatMeasure(
  amount: number | string | null | undefined,
  unit: string | null | undefined,
  locale: string
): string | null {
  const value = toNumber(amount);
  if (value === null) return null;
  const formatted = formatNumber(value, locale);
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Grams below a kilo, kilograms from there: "180 g", "1.2 kg". */
export function formatWeight(
  grams: number | string | null | undefined,
  locale: string
): string | null {
  const value = toNumber(grams);
  if (value === null || value <= 0) return null;
  if (value >= 1000) return `${formatNumber(value / 1000, locale, 2)} kg`;
  return `${formatNumber(value, locale, 0)} g`;
}

/** "120 × 60 × 60 mm", only when all three sides are known. */
export function formatDimensions(
  dimensions: Record<string, unknown> | null | undefined,
  locale: string
): string | null {
  if (!dimensions) return null;
  const sides = ['length', 'width', 'height'].map((key) =>
    toNumber(dimensions[key] as number | string | null | undefined)
  );
  if (sides.some((side) => side === null || side <= 0)) return null;
  return `${sides.map((side) => formatNumber(side as number, locale)).join(' × ')} mm`;
}

export interface NutritionRow {
  /** Key from NUTRITION_KEYS, e.g. "energy_kcal"; the page looks up its label. */
  key: string;
  /** Formatted for display, in the locale's number style. */
  value: string;
}

/** Nutrition values in catalogue order, skipping anything not filled in. */
export function nutritionRows(
  info: Record<string, unknown> | null | undefined,
  locale: string
): NutritionRow[] {
  if (!info) return [];
  const rows: NutritionRow[] = [];
  for (const entry of NUTRITION_KEYS) {
    const value = toNumber(info[entry.key] as number | string | null | undefined);
    if (value === null) continue;
    rows.push({ key: entry.key, value: formatNumber(value, locale) });
  }
  return rows;
}

/** Trimmed, de-duplicated list values for tags, allergens and the like. */
export function cleanList(values: readonly (string | null | undefined)[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = raw?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** True when the compare-at price is a real saving worth striking through. */
export function hasSaving(priceCents: number, compareAtCents: number | null | undefined): boolean {
  return typeof compareAtCents === 'number' && compareAtCents > priceCents;
}
