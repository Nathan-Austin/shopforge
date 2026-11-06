import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

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
  /** What has gone back to the customer so far, in cents. */
  refundedCents: number;
  /** Promo code used at checkout, and what it took off (goods or shipping). */
  discountCode: string | null;
  discountCents: number;
  stripeSessionId: string;
  stripePaymentIntentId: string | null;
  /** Locale the customer checked out in; null for orders before it was recorded. */
  locale: string | null;
  shipping: OrderAddress;
  tracking: { carrier: string | null; number: string | null; url: string | null };
  shippedAt: string | null;
  /** When the customer was emailed that the order shipped; null if never. */
  shippingNotifiedAt: string | null;
  items: OrderItem[];
  createdAt: string;
}

const ORDER_COLUMNS = `
  id, user_id, email, status, currency, subtotal_cents, shipping_cents,
  total_cents, refunded_cents, discount_code, discount_cents,
  stripe_session_id, stripe_payment_intent_id,
  locale, tracking_carrier, tracking_number, tracking_url, shipped_at,
  shipping_notified_at, shipping_name, shipping_line1,
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
  refunded_cents: number | null;
  discount_code: string | null;
  discount_cents: number | null;
  stripe_session_id: string;
  stripe_payment_intent_id: string | null;
  locale: string | null;
  tracking_carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  shipped_at: string | null;
  shipping_notified_at: string | null;
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
    refundedCents: row.refunded_cents ?? 0,
    discountCode: row.discount_code,
    discountCents: row.discount_cents ?? 0,
    stripeSessionId: row.stripe_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    locale: row.locale,
    tracking: {
      carrier: row.tracking_carrier,
      number: row.tracking_number,
      url: row.tracking_url
    },
    shippedAt: row.shipped_at,
    shippingNotifiedAt: row.shipping_notified_at,
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

/** Every status an order can be in, in lifecycle order. */
export const ORDER_STATUSES = [
  'pending',
  'paid',
  'fulfilled',
  'cancelled',
  'refunded',
  'disputed'
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Statuses the owner may set by hand. 'refunded' is not one of them: it is
 * set by the refund flow once the whole amount has gone back through Stripe.
 * Neither is 'disputed', which only the Stripe webhook sets, when the
 * customer's bank pulls the money back.
 */
export const MANUAL_ORDER_STATUSES: readonly OrderStatus[] = ['pending', 'paid', 'fulfilled', 'cancelled'];

/** Statuses an order can be refunded from. */
export const REFUNDABLE_ORDER_STATUSES: readonly OrderStatus[] = ['paid', 'fulfilled'];

/**
 * Orders visible to the caller, newest first. Runs through the caller's own
 * Supabase client, so RLS decides what comes back: a customer gets their
 * own orders, the shop owner gets every order. Nothing here uses the
 * service-role key.
 */
export async function listOrders(
  supabase: SupabaseClient,
  options: { limit?: number } = {}
): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 100);

  if (error || !data) return [];
  return (data as unknown as OrderRow[]).map(toOrder);
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

/** One order by id, through the caller's client (RLS applies). */
export async function getOrderById(
  supabase: SupabaseClient,
  orderId: string
): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_COLUMNS)
    .eq('id', orderId)
    .maybeSingle();

  if (error || !data) return null;
  return toOrder(data as unknown as OrderRow);
}

export interface OrderRefundItem {
  orderItemId: string;
  productName: string;
  quantity: number;
  amountCents: number;
}

export interface OrderRefund {
  id: string;
  orderId: string;
  amountCents: number;
  currency: string;
  kind: 'full' | 'items' | 'percent' | 'amount';
  percent: number | null;
  items: OrderRefundItem[];
  reason: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  stripeRefundId: string | null;
  failureMessage: string | null;
  emailSentAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface OrderRefundRow {
  id: string;
  order_id: string;
  amount_cents: number;
  currency: string;
  kind: OrderRefund['kind'];
  percent: number | string | null;
  items: unknown;
  reason: string | null;
  status: OrderRefund['status'];
  stripe_refund_id: string | null;
  failure_message: string | null;
  email_sent_at: string | null;
  created_at: string;
  completed_at: string | null;
}

function toRefundItems(value: unknown): OrderRefundItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      orderItemId: String(item.orderItemId ?? ''),
      productName: String(item.productName ?? ''),
      quantity: Number(item.quantity ?? 0),
      amountCents: Number(item.amountCents ?? 0)
    }));
}

/**
 * A chargeback, as Stripe reported it. Written only by the webhook, and
 * readable only by the shop owner: a dispute is between the shop and the
 * card network, and the customer who raised it already knows.
 */
export interface OrderDispute {
  id: string;
  orderId: string;
  stripeDisputeId: string;
  amountCents: number;
  currency: string;
  /** Stripe's reason code, e.g. 'fraudulent'. Null when none was given. */
  reason: string | null;
  /** Stripe's dispute status, e.g. 'needs_response', 'won', 'lost'. */
  status: string;
  /** When evidence is due. Null once closed, or if Stripe gave no date. */
  evidenceDueAt: string | null;
  openedAt: string;
  closedAt: string | null;
}

interface OrderDisputeRow {
  id: string;
  order_id: string;
  stripe_dispute_id: string;
  amount_cents: number;
  currency: string;
  reason: string | null;
  status: string;
  evidence_due_at: string | null;
  opened_at: string;
  closed_at: string | null;
}

/**
 * Whether a dispute is still live. Mirrors dispute_is_open() in
 * 0009_disputes.sql, which is what actually blocks a refund.
 */
export function isDisputeOpen(dispute: Pick<OrderDispute, 'status'>): boolean {
  return !['won', 'lost', 'warning_closed'].includes(dispute.status);
}

/** Disputes on an order, oldest first, through the caller's client. */
export async function listOrderDisputes(
  supabase: SupabaseClient,
  orderId: string
): Promise<OrderDispute[]> {
  const { data, error } = await supabase
    .from('order_disputes')
    .select(
      'id, order_id, stripe_dispute_id, amount_cents, currency, reason, status, evidence_due_at, opened_at, closed_at'
    )
    .eq('order_id', orderId)
    .order('opened_at', { ascending: true });

  if (error || !data) return [];
  return (data as unknown as OrderDisputeRow[]).map((row) => ({
    id: row.id,
    orderId: row.order_id,
    stripeDisputeId: row.stripe_dispute_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    reason: row.reason,
    status: row.status,
    evidenceDueAt: row.evidence_due_at,
    openedAt: row.opened_at,
    closedAt: row.closed_at
  }));
}

/** Refund attempts on an order, oldest first, through the caller's client. */
export async function listOrderRefunds(
  supabase: SupabaseClient,
  orderId: string
): Promise<OrderRefund[]> {
  const { data, error } = await supabase
    .from('order_refunds')
    .select(
      'id, order_id, amount_cents, currency, kind, percent, items, reason, status, stripe_refund_id, failure_message, email_sent_at, created_at, completed_at'
    )
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return (data as unknown as OrderRefundRow[]).map((row) => ({
    id: row.id,
    orderId: row.order_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    kind: row.kind,
    percent: row.percent === null ? null : Number(row.percent),
    items: toRefundItems(row.items),
    reason: row.reason,
    status: row.status,
    stripeRefundId: row.stripe_refund_id,
    failureMessage: row.failure_message,
    emailSentAt: row.email_sent_at,
    createdAt: row.created_at,
    completedAt: row.completed_at
  }));
}
