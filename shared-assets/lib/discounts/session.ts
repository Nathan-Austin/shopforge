import 'server-only';

import { cookies } from 'next/headers';

/**
 * The promo code the visitor has applied, in an httpOnly cookie next to the
 * cart id. Only the code is stored, never what it is worth: every page and
 * the checkout route look the code up and re-check it, so a code that is
 * retired after being applied simply stops counting.
 */
export const DISCOUNT_COOKIE_NAME = 'shop_cart_discount';

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // as long as the cart

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS
  };
}

export async function getAppliedDiscountCode(): Promise<string | null> {
  const store = await cookies();
  return store.get(DISCOUNT_COOKIE_NAME)?.value || null;
}

/** Only from a server action or route handler: cookies cannot be set while rendering. */
export async function setAppliedDiscountCode(code: string): Promise<void> {
  const store = await cookies();
  store.set(DISCOUNT_COOKIE_NAME, code, cookieOptions());
}

export async function clearAppliedDiscountCode(): Promise<void> {
  const store = await cookies();
  store.delete(DISCOUNT_COOKIE_NAME);
}
