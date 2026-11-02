import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { one } from '@/lib/supabase/relations';
import {
  calculateCartTotals,
  clampQuantity,
  type CartTotals,
  type ClampReason,
  type StockRules
} from './pricing';
import { getCartSessionId } from './session';

/**
 * Cart reads and writes.
 *
 * `cart_items` has no RLS access for anon or authenticated users, so every
 * query here goes through the service-role client and is only ever reachable
 * from the server. Prices and stock always come from the database; nothing
 * the browser sends is trusted beyond a product id, a variant and a quantity.
 */

/** Columns the cart needs from `products`. */
const PRODUCT_COLUMNS =
  'id, name, slug, image_url, price_cents, currency, is_active, archived_at, stock, track_inventory, allow_backorder, max_order_quantity, size_options, color_options';

interface CartProductRow {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  price_cents: number;
  currency: string;
  is_active: boolean | null;
  archived_at: string | null;
  stock: number | null;
  track_inventory: boolean | null;
  allow_backorder: boolean | null;
  max_order_quantity: number | null;
  size_options: string[] | null;
  color_options: string[] | null;
}

export interface CartLine {
  id: string;
  productId: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  unitPriceCents: number;
  currency: string;
  quantity: number;
  selectedSize: string | null;
  selectedColor: string | null;
  /** Most this line may be set to; null means no limit. */
  maxQuantity: number | null;
  /**
   * False once a product is unpublished or archived. Lines stay visible so
   * the customer can see what changed, but checkout refuses them.
   */
  available: boolean;
}

export interface Cart {
  lines: CartLine[];
  totals: CartTotals;
  currency: string;
}

export const EMPTY_CART: Cart = {
  lines: [],
  totals: { lineCount: 0, itemCount: 0, subtotalCents: 0 },
  currency: 'EUR'
};

function stockRules(product: CartProductRow): StockRules {
  return {
    stock: product.stock,
    trackInventory: product.track_inventory,
    allowBackorder: product.allow_backorder,
    maxOrderQuantity: product.max_order_quantity
  };
}

interface CartItemRow {
  id: string;
  quantity: number;
  selected_size: string | null;
  selected_color: string | null;
  /** Typed as an array by supabase-js without generated types; `one` unwraps it. */
  products: CartProductRow | CartProductRow[] | null;
}

function toLine(row: CartItemRow): CartLine | null {
  const product = one<CartProductRow>(row.products);
  if (!product) return null;

  const max = clampQuantity(Number.MAX_SAFE_INTEGER, stockRules(product)).quantity;

  return {
    id: row.id,
    productId: product.id,
    name: product.name,
    slug: product.slug,
    imageUrl: product.image_url,
    unitPriceCents: product.price_cents,
    currency: product.currency,
    quantity: row.quantity,
    selectedSize: row.selected_size,
    selectedColor: row.selected_color,
    maxQuantity: max >= Number.MAX_SAFE_INTEGER ? null : max,
    available: product.is_active !== false && product.archived_at === null
  };
}

/** The current cart. Safe to call while rendering: it never sets a cookie. */
export async function getCart(): Promise<Cart> {
  const sessionId = await getCartSessionId();
  if (!sessionId) return EMPTY_CART;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('cart_items')
    .select(`id, quantity, selected_size, selected_color, products ( ${PRODUCT_COLUMNS} )`)
    .eq('cart_session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error || !data) return EMPTY_CART;

  const lines = data
    .map((row) => toLine(row))
    .filter((line): line is CartLine => line !== null);

  return {
    lines,
    totals: calculateCartTotals(lines),
    currency: lines[0]?.currency ?? EMPTY_CART.currency
  };
}

export interface CartMutationResult {
  ok: boolean;
  /** Set when the request could not be honoured at all. */
  error?: string;
  /** Set when the quantity was reduced to fit the shop's limits. */
  adjusted?: ClampReason;
  /** What the line ended up at. */
  quantity?: number;
}

async function loadProduct(productId: string): Promise<CartProductRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('id', productId)
    .maybeSingle();

  if (error || !data) return null;
  return data as CartProductRow;
}

/**
 * Checks a chosen variant against what the product actually offers, so a
 * crafted request can't invent a size the shop doesn't sell.
 */
function normaliseVariant(
  options: string[] | null,
  chosen: string | null | undefined
): { value: string | null; valid: boolean } {
  const available = options ?? [];
  if (available.length === 0) {
    // No options configured, so no variant should be recorded.
    return { value: null, valid: true };
  }
  if (!chosen) {
    return { value: null, valid: false };
  }
  const match = available.find((option) => option === chosen);
  return match ? { value: match, valid: true } : { value: null, valid: false };
}

export interface AddToCartInput {
  sessionId: string;
  userId?: string | null;
  productId: string;
  quantity: number;
  selectedSize?: string | null;
  selectedColor?: string | null;
}

/** Adds to an existing line, or starts one, always inside the stock rules. */
export async function addToCart(input: AddToCartInput): Promise<CartMutationResult> {
  const product = await loadProduct(input.productId);
  if (!product) return { ok: false, error: 'not_found' };
  if (product.is_active === false || product.archived_at !== null) {
    return { ok: false, error: 'unavailable' };
  }

  const size = normaliseVariant(product.size_options, input.selectedSize);
  const color = normaliseVariant(product.color_options, input.selectedColor);
  if (!size.valid || !color.valid) {
    return { ok: false, error: 'variant_required' };
  }

  const supabase = createAdminClient();

  // Match the existing line in JS rather than with an upsert: the unique
  // index coalesces the nullable variant columns, which Postgres cannot
  // infer as an ON CONFLICT target.
  const { data: candidates } = await supabase
    .from('cart_items')
    .select('id, quantity, selected_size, selected_color')
    .eq('cart_session_id', input.sessionId)
    .eq('product_id', product.id);

  const existing = (candidates ?? []).find(
    (line) =>
      (line.selected_size ?? null) === size.value &&
      (line.selected_color ?? null) === color.value
  );

  // Quantities add to what is already in the cart, then the total is clamped,
  // so three separate "add one" clicks can't walk past the stock on hand.
  const currentQuantity = existing?.quantity ?? 0;
  const requested = currentQuantity + Math.floor(input.quantity);
  const clamped = clampQuantity(requested, stockRules(product));

  if (clamped.quantity <= 0) {
    return { ok: false, error: 'out_of_stock', adjusted: clamped.reason };
  }

  const { error } = existing
    ? await supabase
        .from('cart_items')
        .update({
          quantity: clamped.quantity,
          user_id: input.userId ?? null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .eq('cart_session_id', input.sessionId)
    : await supabase.from('cart_items').insert({
        cart_session_id: input.sessionId,
        user_id: input.userId ?? null,
        product_id: product.id,
        quantity: clamped.quantity,
        selected_size: size.value,
        selected_color: color.value
      });

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    quantity: clamped.quantity,
    adjusted: clamped.clamped ? clamped.reason : undefined
  };
}

/** Sets a line to an exact quantity, or removes it when that is zero. */
export async function setQuantity(
  sessionId: string,
  lineId: string,
  quantity: number
): Promise<CartMutationResult> {
  const supabase = createAdminClient();

  const { data: line } = await supabase
    .from('cart_items')
    .select(`id, product_id, products ( ${PRODUCT_COLUMNS} )`)
    .eq('id', lineId)
    // Scoped to this cart, so a line id from elsewhere cannot be touched.
    .eq('cart_session_id', sessionId)
    .maybeSingle();

  if (!line) return { ok: false, error: 'not_found' };

  const product = one<CartProductRow>(line.products);
  if (!product) return { ok: false, error: 'not_found' };

  const clamped = clampQuantity(quantity, stockRules(product));

  if (clamped.quantity <= 0) {
    return removeItem(sessionId, lineId);
  }

  const { error } = await supabase
    .from('cart_items')
    .update({ quantity: clamped.quantity, updated_at: new Date().toISOString() })
    .eq('id', lineId)
    .eq('cart_session_id', sessionId);

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    quantity: clamped.quantity,
    adjusted: clamped.clamped ? clamped.reason : undefined
  };
}

export async function removeItem(
  sessionId: string,
  lineId: string
): Promise<CartMutationResult> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('id', lineId)
    .eq('cart_session_id', sessionId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, quantity: 0 };
}

export async function clearCart(sessionId: string): Promise<CartMutationResult> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('cart_items')
    .delete()
    .eq('cart_session_id', sessionId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Attaches a guest cart to the account that just signed in.
 *
 * Lines the account already has win, and the quantities are added together
 * and re-clamped, so signing in never silently loses or over-fills a cart.
 */
export async function mergeGuestCart(
  sessionId: string,
  userId: string
): Promise<void> {
  const supabase = createAdminClient();

  const { data: previous } = await supabase
    .from('cart_items')
    .select('id, cart_session_id, product_id, quantity, selected_size, selected_color')
    .eq('user_id', userId)
    .neq('cart_session_id', sessionId);

  if (!previous?.length) {
    // Nothing to merge; just stamp this cart with the account.
    await supabase
      .from('cart_items')
      .update({ user_id: userId })
      .eq('cart_session_id', sessionId);
    return;
  }

  const { data: current } = await supabase
    .from('cart_items')
    .select('id, product_id, quantity, selected_size, selected_color')
    .eq('cart_session_id', sessionId);

  const currentByKey = new Map(
    (current ?? []).map((line) => [
      [line.product_id, line.selected_size ?? '', line.selected_color ?? ''].join('::'),
      line
    ])
  );

  for (const line of previous) {
    const key = [
      line.product_id,
      line.selected_size ?? '',
      line.selected_color ?? ''
    ].join('::');
    const match = currentByKey.get(key);

    if (match) {
      await setQuantity(sessionId, match.id, match.quantity + line.quantity);
    } else {
      await supabase
        .from('cart_items')
        .update({ cart_session_id: sessionId })
        .eq('id', line.id);
    }
  }

  await supabase
    .from('cart_items')
    .delete()
    .eq('user_id', userId)
    .neq('cart_session_id', sessionId);

  await supabase
    .from('cart_items')
    .update({ user_id: userId })
    .eq('cart_session_id', sessionId);
}
