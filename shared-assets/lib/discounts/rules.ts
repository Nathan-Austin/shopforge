/**
 * Promo code rules.
 *
 * Pure functions: whether a code may be used for this cart right now, and
 * what it takes off. The cart, the checkout route and the admin preview all
 * call these, so the customer sees the same answer everywhere, and Stripe
 * is only ever asked to apply a code the shop has already accepted.
 */

export type DiscountKind = 'percent' | 'amount' | 'free_shipping';

export const DISCOUNT_KINDS: readonly DiscountKind[] = ['percent', 'amount', 'free_shipping'];

export interface DiscountCode {
  id: string;
  /** Uppercase, trimmed. */
  code: string;
  kind: DiscountKind;
  percentOff: number | null;
  amountOffCents: number | null;
  /** ISO currency the amount and minimum are in; null means any. */
  currency: string | null;
  minSubtotalCents: number | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  active: boolean;
  stripeCouponId?: string | null;
  stripePromotionCodeId?: string | null;
}

/** Codes are letters, digits, dash and underscore, 3 to 32 long. */
export const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

/** What the customer typed, as it is stored: trimmed and uppercased. */
export function normalizeCode(input: string | null | undefined): string {
  return (input ?? '').trim().toUpperCase();
}

export function isWellFormedCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export type DiscountError =
  /** Not a code at all (wrong characters or length). */
  | 'invalid_format'
  /** No such code. */
  | 'not_found'
  /** Retired by the owner. */
  | 'inactive'
  /** Before its start date. */
  | 'not_started'
  /** Past its end date. */
  | 'expired'
  /** Used as many times as allowed. */
  | 'exhausted'
  /** The cart is below the code's minimum; `minimumCents` says how much. */
  | 'min_subtotal'
  /** The code is in another currency than the cart. */
  | 'currency_mismatch'
  /** Free shipping when shipping is already free: nothing to take off. */
  | 'nothing_to_discount';

export type DiscountCheck =
  | { ok: true }
  | { ok: false; error: DiscountError; minimumCents?: number };

export interface CartSnapshot {
  subtotalCents: number;
  shippingCents: number;
  currency: string;
}

/**
 * May this code be used for this cart right now? `now` is injectable so
 * date windows can be tested.
 */
export function checkDiscount(
  code: DiscountCode | null,
  cart: CartSnapshot,
  now: Date = new Date()
): DiscountCheck {
  if (!code) return { ok: false, error: 'not_found' };
  if (!code.active) return { ok: false, error: 'inactive' };

  const time = now.getTime();
  if (code.startsAt && Date.parse(code.startsAt) > time) return { ok: false, error: 'not_started' };
  if (code.endsAt && Date.parse(code.endsAt) <= time) return { ok: false, error: 'expired' };

  if (code.maxRedemptions !== null && code.redemptionCount >= code.maxRedemptions) {
    return { ok: false, error: 'exhausted' };
  }

  if (code.currency && code.currency.toUpperCase() !== cart.currency.toUpperCase()) {
    return { ok: false, error: 'currency_mismatch' };
  }

  if (code.minSubtotalCents !== null && cart.subtotalCents < code.minSubtotalCents) {
    return { ok: false, error: 'min_subtotal', minimumCents: code.minSubtotalCents };
  }

  if (code.kind === 'free_shipping' && cart.shippingCents <= 0) {
    return { ok: false, error: 'nothing_to_discount' };
  }

  return { ok: true };
}

export interface DiscountOutcome {
  /** Taken off the goods (percent and amount codes). */
  discountCents: number;
  /** Shipping after the code: zero for free shipping, unchanged otherwise. */
  shippingCents: number;
  /** Shipping saved by a free-shipping code, for the order record. */
  shippingDiscountCents: number;
  totalCents: number;
}

/**
 * What the cart costs with the code applied. Never below zero: an amount
 * code bigger than the subtotal takes the subtotal off, no more. Rounded
 * to the cent the way Stripe rounds a percent coupon (half up).
 */
export function applyDiscount(code: DiscountCode, cart: CartSnapshot): DiscountOutcome {
  const subtotal = Math.max(0, Math.floor(cart.subtotalCents));
  const shipping = Math.max(0, Math.floor(cart.shippingCents));

  let discountCents = 0;
  let shippingCents = shipping;

  switch (code.kind) {
    case 'percent':
      discountCents = Math.min(subtotal, Math.round((subtotal * (code.percentOff ?? 0)) / 100));
      break;
    case 'amount':
      discountCents = Math.min(subtotal, Math.max(0, Math.round(code.amountOffCents ?? 0)));
      break;
    case 'free_shipping':
      shippingCents = 0;
      break;
  }

  return {
    discountCents,
    shippingCents,
    shippingDiscountCents: shipping - shippingCents,
    totalCents: subtotal - discountCents + shippingCents
  };
}

/** Totals without a code, in the same shape, so callers need one code path. */
export function noDiscount(cart: CartSnapshot): DiscountOutcome {
  const subtotal = Math.max(0, Math.floor(cart.subtotalCents));
  const shipping = Math.max(0, Math.floor(cart.shippingCents));
  return { discountCents: 0, shippingCents: shipping, shippingDiscountCents: 0, totalCents: subtotal + shipping };
}

/** Whether a code is live for new customers, for the admin list's status column. */
export type DiscountStatus = 'active' | 'scheduled' | 'expired' | 'exhausted' | 'retired';

export function discountStatus(code: DiscountCode, now: Date = new Date()): DiscountStatus {
  if (!code.active) return 'retired';
  const time = now.getTime();
  if (code.endsAt && Date.parse(code.endsAt) <= time) return 'expired';
  if (code.maxRedemptions !== null && code.redemptionCount >= code.maxRedemptions) return 'exhausted';
  if (code.startsAt && Date.parse(code.startsAt) > time) return 'scheduled';
  return 'active';
}

export interface NewDiscountInput {
  code: string;
  kind: DiscountKind;
  /** Percent as typed, e.g. "10" or "12.5". */
  percent?: string | null;
  /** Amount in major units as typed, e.g. "5" or "7.50". */
  amount?: string | null;
  currency?: string | null;
  /** Minimum subtotal in major units as typed. */
  minSubtotal?: string | null;
  /** Local datetime strings from <input type="datetime-local">, or ISO. */
  startsAt?: string | null;
  endsAt?: string | null;
  maxRedemptions?: string | null;
}

export type NewDiscountError =
  | 'code_format'
  | 'kind'
  | 'percent'
  | 'amount'
  | 'currency'
  | 'min_subtotal'
  | 'dates'
  | 'max_redemptions';

export type NewDiscountPlan =
  | {
      ok: true;
      row: {
        code: string;
        kind: DiscountKind;
        percent_off: number | null;
        amount_off_cents: number | null;
        currency: string | null;
        min_subtotal_cents: number | null;
        starts_at: string | null;
        ends_at: string | null;
        max_redemptions: number | null;
      };
    }
  | { ok: false; error: NewDiscountError };

function majorToCents(input: string | null | undefined): number | null | 'bad' {
  const raw = (input ?? '').trim().replace(',', '.');
  if (raw === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return 'bad';
  return Math.round(Number(raw) * 100);
}

function toIso(input: string | null | undefined): string | null | 'bad' {
  const raw = (input ?? '').trim();
  if (raw === '') return null;
  const time = Date.parse(raw);
  return Number.isNaN(time) ? 'bad' : new Date(time).toISOString();
}

/**
 * Validates what the owner typed into the "new code" form and shapes it
 * for the database. Every error names the field, so the form can say
 * exactly what to fix.
 */
export function planNewDiscount(input: NewDiscountInput): NewDiscountPlan {
  const code = normalizeCode(input.code);
  if (!isWellFormedCode(code)) return { ok: false, error: 'code_format' };
  if (!DISCOUNT_KINDS.includes(input.kind)) return { ok: false, error: 'kind' };

  const currency = (input.currency ?? '').trim().toUpperCase() || null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'currency' };

  let percent_off: number | null = null;
  let amount_off_cents: number | null = null;

  if (input.kind === 'percent') {
    const raw = (input.percent ?? '').trim().replace(',', '.');
    const value = raw === '' ? Number.NaN : Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > 100) return { ok: false, error: 'percent' };
    percent_off = Math.round(value * 100) / 100;
  }

  if (input.kind === 'amount') {
    const cents = majorToCents(input.amount);
    if (cents === 'bad' || cents === null || cents <= 0) return { ok: false, error: 'amount' };
    if (!currency) return { ok: false, error: 'currency' };
    amount_off_cents = cents;
  }

  const min = majorToCents(input.minSubtotal);
  if (min === 'bad') return { ok: false, error: 'min_subtotal' };
  if (min !== null && min > 0 && !currency) return { ok: false, error: 'currency' };

  const starts_at = toIso(input.startsAt);
  const ends_at = toIso(input.endsAt);
  if (starts_at === 'bad' || ends_at === 'bad') return { ok: false, error: 'dates' };
  if (starts_at && ends_at && Date.parse(ends_at) <= Date.parse(starts_at)) {
    return { ok: false, error: 'dates' };
  }

  const maxRaw = (input.maxRedemptions ?? '').trim();
  let max_redemptions: number | null = null;
  if (maxRaw !== '') {
    const value = Number(maxRaw);
    if (!Number.isInteger(value) || value <= 0) return { ok: false, error: 'max_redemptions' };
    max_redemptions = value;
  }

  return {
    ok: true,
    row: {
      code,
      kind: input.kind,
      percent_off,
      amount_off_cents,
      currency,
      min_subtotal_cents: min !== null && min > 0 ? min : null,
      starts_at,
      ends_at,
      max_redemptions
    }
  };
}
