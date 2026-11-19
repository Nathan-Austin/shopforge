'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { notificationForStatusChange } from '@/lib/orders/notifications';
import { sendShippingNotification } from '@/lib/orders/notify';
import {
  getOrderById,
  MANUAL_ORDER_STATUSES,
  type OrderStatus
} from '@/lib/orders/service';
import { ensureShopOwner } from '../lib/auth';

interface OrderActionContext {
  locale: string;
}

/**
 * Outcome codes the orders page turns into a banner. They travel in the
 * URL (?notice=...&detail=...) because the status form is a plain server
 * action with no client state to hold a result.
 */
export type OrderNotice =
  | 'status_saved'
  | 'status_failed'
  | 'shipping_sent'
  | 'shipping_off'
  | 'shipping_failed'
  | 'not_authorized';

function finish(locale: string, notice: OrderNotice, detail?: string): never {
  revalidatePath(`/${locale}/admin/orders`);
  revalidatePath(`/${locale}/account/orders`);
  const params = new URLSearchParams({ notice });
  if (detail) params.set('detail', detail.slice(0, 200));
  redirect(`/${locale}/admin/orders?${params.toString()}`);
}

/**
 * Records a new status (and tracking details) on an order, then decides
 * whether the customer should hear about it. The decision is
 * notificationForStatusChange(): only the first arrival at 'fulfilled'
 * emails, so flipping the status back and forth cannot spam anyone. The
 * database function re-checks that the caller is the shop owner.
 */
export async function updateOrderStatus(
  context: OrderActionContext,
  formData: FormData
): Promise<void> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) finish(context.locale, 'not_authorized');

  const orderId = formData.get('order_id')?.toString();
  const status = formData.get('status')?.toString() as OrderStatus | undefined;
  if (!orderId || !status || !MANUAL_ORDER_STATUSES.includes(status)) {
    finish(context.locale, 'status_failed', 'Missing order or status');
  }

  // The status before the save is what the notification rule needs.
  const before = await getOrderById(supabase, orderId);
  if (!before) finish(context.locale, 'status_failed', 'Order not found');

  const field = (name: string) => formData.get(name)?.toString().trim() || null;
  const { error: rpcError } = await supabase.rpc('set_order_status', {
    p_order_id: orderId,
    p_status: status,
    p_tracking_carrier: field('tracking_carrier'),
    p_tracking_number: field('tracking_number'),
    p_tracking_url: field('tracking_url')
  });
  if (rpcError) finish(context.locale, 'status_failed', rpcError.message);

  const kind = notificationForStatusChange({
    from: before.status,
    to: status,
    shippingNotifiedAt: before.shippingNotifiedAt
  });
  if (kind !== 'shipped') finish(context.locale, 'status_saved');

  // Re-read so the email carries the tracking details just saved.
  const after = await getOrderById(supabase, orderId);
  const result = await sendShippingNotification(supabase, after ?? before, context.locale);
  if (result.sent) finish(context.locale, 'shipping_sent', before.email);
  if (result.reason === 'not-configured') finish(context.locale, 'shipping_off');
  finish(context.locale, 'shipping_failed', result.error);
}

/**
 * The owner's "send / resend shipping email" button. Deliberate, so there
 * is no once-only guard here; the automatic path above has it.
 */
export async function sendShippingEmail(
  context: OrderActionContext,
  formData: FormData
): Promise<void> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) finish(context.locale, 'not_authorized');

  const orderId = formData.get('order_id')?.toString();
  const order = orderId ? await getOrderById(supabase, orderId) : null;
  if (!order) finish(context.locale, 'status_failed', 'Order not found');

  const result = await sendShippingNotification(supabase, order, context.locale);
  if (result.sent) finish(context.locale, 'shipping_sent', order.email);
  if (result.reason === 'not-configured') finish(context.locale, 'shipping_off');
  finish(context.locale, 'shipping_failed', result.error);
}
