'use server';

import { revalidatePath } from 'next/cache';

import { getCart } from '@/lib/cart/service';
import { calculateShippingCost } from '@/lib/checkout/pricing';
import {
  checkDiscount,
  isWellFormedCode,
  normalizeCode,
  type DiscountError
} from './rules';
import { findDiscountCode } from './service';
import { clearAppliedDiscountCode, setAppliedDiscountCode } from './session';

export type ApplyDiscountResult =
  | { ok: true; code: string }
  | { ok: false; error: DiscountError | 'empty_cart' | 'failed'; minimumCents?: number; currency?: string };

/**
 * Applies a typed code to the visitor's cart. The code is validated against
 * the cart as it is now; what it is worth is never stored, only the code,
 * so later pages re-check it.
 */
export async function applyDiscountAction(input: {
  locale: string;
  code: string;
}): Promise<ApplyDiscountResult> {
  const code = normalizeCode(input.code);
  if (!isWellFormedCode(code)) return { ok: false, error: 'invalid_format' };

  const cart = await getCart();
  if (cart.lines.length === 0) return { ok: false, error: 'empty_cart' };

  const discount = await findDiscountCode(code);
  const check = checkDiscount(discount, {
    subtotalCents: cart.totals.subtotalCents,
    shippingCents: calculateShippingCost(cart.totals.subtotalCents),
    currency: cart.currency
  });
  if (!check.ok) {
    return { ok: false, error: check.error, minimumCents: check.minimumCents, currency: cart.currency };
  }

  await setAppliedDiscountCode(code);
  revalidatePath(`/${input.locale}/cart`);
  revalidatePath(`/${input.locale}/checkout`);
  return { ok: true, code };
}

export async function removeDiscountAction(input: { locale: string }): Promise<{ ok: true }> {
  await clearAppliedDiscountCode();
  revalidatePath(`/${input.locale}/cart`);
  revalidatePath(`/${input.locale}/checkout`);
  return { ok: true };
}
