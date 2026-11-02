'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import {
  addToCart as addToCartRecord,
  clearCart as clearCartRecords,
  getCart,
  mergeGuestCart,
  removeItem as removeItemRecord,
  setQuantity as setQuantityRecord,
  type Cart,
  type CartMutationResult
} from './service';
import { ensureCartSessionId, getCartSessionId } from './session';

/**
 * Cart server actions.
 *
 * The cart id is always read from the httpOnly cookie here, never taken
 * from the caller, so the only thing a client can choose is which product
 * and how many. Quantities are re-checked against the database every time.
 */

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Revalidates the pages that show cart state, including the header badge. */
function revalidateCart(locale: string) {
  revalidatePath(`/${locale}`, 'layout');
}

export async function addToCartAction(input: {
  locale: string;
  productId: string;
  quantity?: number;
  selectedSize?: string | null;
  selectedColor?: string | null;
}): Promise<CartMutationResult> {
  const sessionId = await ensureCartSessionId();
  const userId = await currentUserId();

  const result = await addToCartRecord({
    sessionId,
    userId,
    productId: input.productId,
    quantity: input.quantity ?? 1,
    selectedSize: input.selectedSize ?? null,
    selectedColor: input.selectedColor ?? null
  });

  if (result.ok) revalidateCart(input.locale);
  return result;
}

export async function setQuantityAction(input: {
  locale: string;
  lineId: string;
  quantity: number;
}): Promise<CartMutationResult> {
  const sessionId = await getCartSessionId();
  if (!sessionId) return { ok: false, error: 'no_cart' };

  const result = await setQuantityRecord(sessionId, input.lineId, input.quantity);
  if (result.ok) revalidateCart(input.locale);
  return result;
}

export async function removeItemAction(input: {
  locale: string;
  lineId: string;
}): Promise<CartMutationResult> {
  const sessionId = await getCartSessionId();
  if (!sessionId) return { ok: false, error: 'no_cart' };

  const result = await removeItemRecord(sessionId, input.lineId);
  if (result.ok) revalidateCart(input.locale);
  return result;
}

export async function clearCartAction(input: {
  locale: string;
}): Promise<CartMutationResult> {
  const sessionId = await getCartSessionId();
  if (!sessionId) return { ok: false, error: 'no_cart' };

  const result = await clearCartRecords(sessionId);
  if (result.ok) revalidateCart(input.locale);
  return result;
}

/** The current cart, for server components and for refreshing client state. */
export async function getCartAction(): Promise<Cart> {
  return getCart();
}

/**
 * Call after a successful sign-in to keep whatever the visitor put in their
 * cart beforehand, and to pull back a cart they left on another device.
 */
export async function mergeGuestCartAction(locale: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;

  const sessionId = await ensureCartSessionId();
  await mergeGuestCart(sessionId, userId);
  revalidateCart(locale);
}
