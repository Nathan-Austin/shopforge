import 'server-only';

import { createAdminClient } from '../supabase/admin';

/**
 * Orders, as written by the Stripe webhook.
 *
 * Reads go through the service-role client because the shopper who just
 * paid may be a guest with no account, and so no RLS identity. The only
 * way in is the Stripe session id, which Stripe hands back to the browser
 * on the success redirect and to nobody else.
 */

export interface OrderItem {
  id: string;
  productId: string | null;
  productName: string;
  unitPriceCents: number;
  quantity: number;
  selectedSize: string | null;
  selectedColor: string | null;
}

export interface OrderAddress {
  name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  postalCode: string | null;
  region: string | null;
  country: string | null;
}

export interface Order {
  id: string;
  userId: string | null;
  email: string;
  status: string;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  stripeSessionId: string;
  shipping: OrderAddress;
  items: OrderItem[];
  createdAt: string;
}

const ORDER_COLUMNS = `
  id, user_id, email, status, currency, subtotal_cents, shipping_cents,
  total_cents, stripe_session_id, shipping_name, shipping_line1,
  shipping_line2, shipping_city, shipping_postal_code, shipping_region,
  shipping_country, created_at,
  order_items ( id, product_id, product_name, unit_price_cents, quantity,
    selected_size, selected_color )
`;

interface OrderItemRow {
  id: string;
  product_id: string | null;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  selected_size: string | null;
  selected_color: string | null;
}

interface OrderRow {
  id: string;
  user_id: string | null;
  email: string;
  status: string;
  currency: string;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  stripe_session_id: string;
  shipping_name: string | null;
  shipping_line1: string | null;
  shipping_line2: string | null;
  shipping_city: string | null;
  shipping_postal_code: string | null;
  shipping_region: string | null;
  shipping_country: string | null;
  created_at: string;
  order_items: OrderItemRow[] | null;
}

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    status: row.status,
    currency: row.currency,
    subtotalCents: row.subtotal_cents,
    shippingCents: row.shipping_cents,
    totalCents: row.total_cents,
    stripeSessionId: row.stripe_session_id,
    shipping: {
      name: row.shipping_name,
      line1: row.shipping_line1,
      line2: row.shipping_line2,
      city: row.shipping_city,
      postalCode: row.shipping_postal_code,
      region: row.shipping_region,
      country: row.shipping_country
    },
    items: (row.order_items ?? []).map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      unitPriceCents: item.unit_price_cents,
      quantity: item.quantity,
      selectedSize: item.selected_size,
      selectedColor: item.selected_color
    })),
    createdAt: row.created_at
  };
}

/** Short, human-friendly order reference for receipts and the success page. */
export function orderReference(order: Pick<Order, 'id'>): string {
  return order.id.slice(0, 8).toUpperCase();
}

/**
 * The order for a Stripe Checkout session, or null if the webhook has not
 * written it yet (Stripe can redirect the browser before the event lands).
 */
export async function getOrderByStripeSession(sessionId: string): Promise<Order | null> {
  // Stripe session ids look like cs_test_... or cs_live_...; anything else
  // is not worth a round trip.
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null;

  const { data, error } = await createAdminClient()
    .from('orders')
    .select(ORDER_COLUMNS)
    .eq('stripe_session_id', sessionId)
    .maybeSingle();

  if (error || !data) return null;
  return toOrder(data as unknown as OrderRow);
}
