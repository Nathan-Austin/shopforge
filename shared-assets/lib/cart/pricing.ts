/**
 * Cart maths and stock clamping.
 *
 * Pure functions only: no database, no cookies. Everything here is decided
 * from values the server has already read, so it can be reasoned about and
 * tested directly. The server actions in ./service.ts apply the results.
 */

export interface StockRules {
  /** Units on hand. */
  stock?: number | null;
  /** When false, stock is ignored and any quantity is allowed. */
  trackInventory?: boolean | null;
  /** When true, customers may order beyond the stock on hand. */
  allowBackorder?: boolean | null;
  /** Hard cap per order, whatever the stock says. */
  maxOrderQuantity?: number | null;
}

export type ClampReason =
  /** The requested quantity was used as-is. */
  | 'ok'
  /** Cut down to the stock on hand. */
  | 'stock'
  /** Cut down to the per-order maximum. */
  | 'max_order'
  /** Nothing can be added: tracked, out of stock, no backorders. */
  | 'out_of_stock';

export interface ClampResult {
  /** What the line should actually be set to. Never negative. */
  quantity: number;
  /** True when the customer asked for more than they got. */
  clamped: boolean;
  reason: ClampReason;
}

/** Largest quantity allowed for a line, or 0 when it cannot be ordered. */
export function maxAllowedQuantity(rules: StockRules): number {
  const limits: number[] = [];

  const tracking = rules.trackInventory === true;
  if (tracking && rules.allowBackorder !== true) {
    limits.push(Math.max(0, Math.floor(rules.stock ?? 0)));
  }

  if (typeof rules.maxOrderQuantity === 'number' && rules.maxOrderQuantity > 0) {
    limits.push(Math.floor(rules.maxOrderQuantity));
  }

  if (limits.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...limits);
}

/**
 * Brings a requested quantity inside what the shop allows.
 *
 * Quantities are clamped rather than rejected, so asking for 10 of something
 * with 3 left puts 3 in the cart and says so, instead of failing outright.
 */
export function clampQuantity(requested: number, rules: StockRules): ClampResult {
  const wanted = Math.floor(Number.isFinite(requested) ? requested : 0);

  if (wanted <= 0) {
    return { quantity: 0, clamped: requested > 0, reason: 'ok' };
  }

  const max = maxAllowedQuantity(rules);

  if (max === Number.POSITIVE_INFINITY) {
    return { quantity: wanted, clamped: false, reason: 'ok' };
  }

  if (max <= 0) {
    return { quantity: 0, clamped: true, reason: 'out_of_stock' };
  }

  if (wanted <= max) {
    return { quantity: wanted, clamped: false, reason: 'ok' };
  }

  // Which limit bit decides the message the customer sees.
  const stockLimit =
    rules.trackInventory === true && rules.allowBackorder !== true
      ? Math.max(0, Math.floor(rules.stock ?? 0))
      : Number.POSITIVE_INFINITY;

  return {
    quantity: max,
    clamped: true,
    reason: max === stockLimit ? 'stock' : 'max_order'
  };
}

export interface CartLinePricing {
  quantity: number;
  unitPriceCents: number;
}

export interface CartTotals {
  /** Number of distinct lines. */
  lineCount: number;
  /** Total units, which is what the header badge shows. */
  itemCount: number;
  subtotalCents: number;
}

/** Totals for a set of cart lines. */
export function calculateCartTotals(lines: CartLinePricing[]): CartTotals {
  let itemCount = 0;
  let subtotalCents = 0;

  for (const line of lines) {
    const quantity = Math.max(0, Math.floor(line.quantity));
    itemCount += quantity;
    subtotalCents += quantity * Math.round(line.unitPriceCents);
  }

  return { lineCount: lines.length, itemCount, subtotalCents };
}

/**
 * Identifies a line within a cart. A product added once in a small and once
 * in a large is two lines, so size and colour are part of the identity.
 */
export function cartLineKey(
  productId: string,
  selectedSize?: string | null,
  selectedColor?: string | null
): string {
  return [productId, selectedSize ?? '', selectedColor ?? ''].join('::');
}
