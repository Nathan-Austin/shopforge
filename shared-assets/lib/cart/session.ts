import 'server-only';

import { cookies } from 'next/headers';

/**
 * The guest cart id.
 *
 * It lives in an httpOnly cookie, so the browser can't read it and it is
 * never sent in a request body. Every cart action and the checkout route
 * read it here on the server, which means a customer can only ever act on
 * their own cart: there is no cart id for a caller to substitute.
 */
export const CART_COOKIE_NAME = 'shop_cart_session';

const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CART_COOKIE_MAX_AGE_SECONDS
  };
}

/** The current cart id, or null when the visitor has no cart yet. */
export async function getCartSessionId(): Promise<string | null> {
  const store = await cookies();
  return store.get(CART_COOKIE_NAME)?.value ?? null;
}

/**
 * The current cart id, creating one if needed.
 *
 * Only call this from a server action or route handler: setting a cookie
 * while rendering a page throws in Next.
 */
export async function ensureCartSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CART_COOKIE_NAME)?.value;
  if (existing) return existing;

  const id = crypto.randomUUID();
  store.set(CART_COOKIE_NAME, id, cookieOptions());
  return id;
}

/** Refreshes the expiry so an active cart doesn't lapse. */
export async function touchCartSession(id: string): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE_NAME, id, cookieOptions());
}

export async function clearCartSession(): Promise<void> {
  const store = await cookies();
  store.delete(CART_COOKIE_NAME);
}
