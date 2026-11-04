import 'server-only';

import { calculateShippingCost } from '@/lib/checkout/pricing';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  applyDiscount,
  checkDiscount,
  isWellFormedCode,
  noDiscount,
  normalizeCode,
  type DiscountCheck,
  type DiscountCode,
  type DiscountOutcome
} from './rules';
import { getAppliedDiscountCode } from './session';

/**
 * Looking codes up and pricing a cart with one.
 *
 * Reads use the service-role client because shoppers have no access to
 * discount_codes (so nobody can list the codes that exist); a code is only
 * ever found by typing it exactly.
 */

export const DISCOUNT_COLUMNS =
  'id, code, kind, percent_off, amount_off_cents, currency, min_subtotal_cents, starts_at, ends_at, max_redemptions, redemption_count, active, stripe_coupon_id, stripe_promotion_code_id, created_at';

export interface DiscountRow {
  id: string;
  code: string;
  kind: DiscountCode['kind'];
  percent_off: number | string | null;
  amount_off_cents: number | null;
  currency: string | null;
  min_subtotal_cents: number | null;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  active: boolean;
  stripe_coupon_id: string | null;
  stripe_promotion_code_id: string | null;
  created_at?: string;
}

export function toDiscountCode(row: DiscountRow): DiscountCode {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    percentOff: row.percent_off === null ? null : Number(row.percent_off),
    amountOffCents: row.amount_off_cents,
    currency: row.currency,
    minSubtotalCents: row.min_subtotal_cents,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    maxRedemptions: row.max_redemptions,
    redemptionCount: row.redemption_count,
    active: row.active,
    stripeCouponId: row.stripe_coupon_id,
    stripePromotionCodeId: row.stripe_promotion_code_id
  };
}

/** The code as stored, or null. Malformed input never reaches the database. */
export async function findDiscountCode(input: string): Promise<DiscountCode | null> {
  const code = normalizeCode(input);
  if (!isWellFormedCode(code)) return null;

  const { data } = await createAdminClient()
    .from('discount_codes')
    .select(DISCOUNT_COLUMNS)
    .eq('code', code)
    .maybeSingle();

  return data ? toDiscountCode(data as DiscountRow) : null;
}

export interface CartDiscountState {
  /** What the visitor applied (cookie), even if it no longer passes. */
  appliedCode: string | null;
  /** The code row, when the applied code exists. */
  discount: DiscountCode | null;
  /** Null when nothing is applied; otherwise why it does or does not count. */
  check: DiscountCheck | null;
  /** Shipping before any code, from the shop's flat rate. */
  shippingCents: number;
  /** What the cart costs now. Equals noDiscount() when nothing counts. */
  outcome: DiscountOutcome;
}

/**
 * Prices a cart with whatever code the visitor has applied, re-checking it
 * against the catalogue now. Pages and the checkout route all call this,
 * so they cannot disagree about the total.
 */
export async function resolveCartDiscount(cart: {
  subtotalCents: number;
  currency: string;
}): Promise<CartDiscountState> {
  const shippingCents = calculateShippingCost(cart.subtotalCents);
  const snapshot = { subtotalCents: cart.subtotalCents, shippingCents, currency: cart.currency };
  const appliedCode = await getAppliedDiscountCode();

  if (!appliedCode) {
    return { appliedCode: null, discount: null, check: null, shippingCents, outcome: noDiscount(snapshot) };
  }

  const discount = await findDiscountCode(appliedCode);
  const check = checkDiscount(discount, snapshot);
  const outcome = check.ok && discount ? applyDiscount(discount, snapshot) : noDiscount(snapshot);
  return { appliedCode, discount, check, shippingCents, outcome };
}
