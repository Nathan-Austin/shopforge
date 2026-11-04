'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import { getEmailConfig } from '@/lib/email/config';
import { formatPrice } from '@/lib/format';
import { renderRefundNotification } from '@/lib/email/refundNotification';
import { sendEmail } from '@/lib/email/send';
import {
  isRefundConfirmed,
  planRefund,
  REFUND_FIELDS,
  refundedQuantities,
  refundRequestFromForm,
  type RefundKind,
  type RefundPlanError
} from '@/lib/orders/refunds';
import {
  getOrderById,
  listOrderRefunds,
  orderReference,
  REFUNDABLE_ORDER_STATUSES,
  type OrderStatus
} from '@/lib/orders/service';
import { getStripeServerClient } from '@/lib/stripe/server';
import { ensureShopOwner } from '../lib/auth';

export type RefundActionError =
  | RefundPlanError
  | 'not_authorized'
  | 'not_confirmed'
  | 'not_found'
  | 'no_payment'
  | 'not_refundable'
  | 'stripe'
  | 'failed';

export type RefundActionResult =
  | {
      ok: true;
      amountCents: number;
      currency: string;
      kind: RefundKind;
      stripeRefundId: string;
      email: 'sent' | 'not-configured' | 'failed';
      emailError?: string;
    }
  | { ok: false; error: RefundActionError; message?: string };

interface RefundContext {
  locale: string;
  orderId: string;
}

/**
 * Refunds some or all of an order through Stripe.
 *
 * Order of operations matters: the amount is reserved in the database
 * first (begin_order_refund locks the order and checks what is left), then
 * Stripe is called with that row's id as the idempotency key, then the row
 * is completed or failed. A crash between the Stripe call and completion
 * leaves a pending row the owner can see and check against Stripe; the
 * idempotency key means retrying cannot refund twice. The customer is
 * emailed last, with the owner in copy, and a mail failure never undoes a
 * refund that has already happened.
 */
export async function refundOrder(
  context: RefundContext,
  _previous: RefundActionResult | null,
  formData: FormData
): Promise<RefundActionResult> {
  const { error: authError, supabase } = await ensureShopOwner();
  if (authError || !supabase) return { ok: false, error: 'not_authorized' };

  // The confirmation word is checked before anything is read, so a stray
  // submit does nothing at all.
  if (!isRefundConfirmed(formData.get(REFUND_FIELDS.confirm)?.toString())) {
    return { ok: false, error: 'not_confirmed' };
  }

  const order = await getOrderById(supabase, context.orderId);
  if (!order) return { ok: false, error: 'not_found' };
  if (!REFUNDABLE_ORDER_STATUSES.includes(order.status as OrderStatus)) {
    return { ok: false, error: 'not_refundable' };
  }
  if (!order.stripePaymentIntentId) return { ok: false, error: 'no_payment' };

  const earlier = await listOrderRefunds(supabase, order.id);
  const alreadyRefunded = refundedQuantities(earlier);

  const plan = planRefund(
    {
      totalCents: order.totalCents,
      refundedCents: order.refundedCents,
      items: order.items.map((item) => ({
        id: item.id,
        productName: item.productName,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
        refundedQuantity: alreadyRefunded.get(item.id) ?? 0
      }))
    },
    refundRequestFromForm(formData)
  );
  if (!plan.ok) return { ok: false, error: plan.error };

  const reason = formData.get(REFUND_FIELDS.reason)?.toString().trim().slice(0, 1000) || null;

  // 1. Reserve.
  const { data: refundId, error: beginError } = await supabase.rpc('begin_order_refund', {
    p_order_id: order.id,
    p_amount_cents: plan.amountCents,
    p_kind: plan.kind,
    p_items: plan.items,
    p_percent: plan.percent,
    p_reason: reason
  });
  if (beginError || typeof refundId !== 'string') {
    return { ok: false, error: 'failed', message: beginError?.message ?? 'No refund id' };
  }

  // 2. Move the money.
  let stripeRefundId: string;
  try {
    const refund = await getStripeServerClient().refunds.create(
      {
        payment_intent: order.stripePaymentIntentId,
        amount: plan.amountCents,
        reason: 'requested_by_customer',
        metadata: { order_id: order.id, refund_id: refundId }
      },
      { idempotencyKey: `order-refund-${refundId}` }
    );
    stripeRefundId = refund.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await supabase.rpc('fail_order_refund', { p_refund_id: refundId, p_message: message });
    return { ok: false, error: 'stripe', message };
  }

  // 3. Record it.
  const { error: completeError } = await supabase.rpc('complete_order_refund', {
    p_refund_id: refundId,
    p_stripe_refund_id: stripeRefundId
  });
  if (completeError) {
    // The money has moved. Say so loudly rather than pretend otherwise.
    return {
      ok: false,
      error: 'failed',
      message: `Stripe refund ${stripeRefundId} succeeded but could not be recorded: ${completeError.message}`
    };
  }

  revalidatePath(`/${context.locale}/admin/orders`);
  revalidatePath(`/${context.locale}/admin/orders/${order.id}`);
  revalidatePath(`/${context.locale}/account/orders`);

  // 4. Tell the customer, in their language, with the owner in copy.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? null;
  const customerLocale = order.locale || context.locale;
  const shopName = process.env.NEXT_PUBLIC_SHOP_NAME || 'Our shop';
  const reference = orderReference(order);
  const refundedCents = order.refundedCents + plan.amountCents;
  const money = (cents: number) => formatPrice(cents, order.currency, customerLocale);
  const t = await getTranslations({ locale: customerLocale, namespace: 'Email.refund' });
  const email = renderRefundNotification(
    {
      reference,
      shopName,
      currency: order.currency,
      amountCents: plan.amountCents,
      totalCents: order.totalCents,
      refundedCents,
      items: plan.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        amountCents: item.amountCents
      })),
      reason,
      orderUrl: siteUrl ? `${siteUrl}/${customerLocale}/account/orders` : null
    },
    {
      subject: t('subject', { shop: shopName, amount: money(plan.amountCents), reference }),
      headlineFull: t('headlineFull'),
      headlinePartial: t('headlinePartial'),
      summaryFull: t('summaryFull', { total: money(order.totalCents), reference }),
      summaryPartial: t('summaryPartial', { amount: money(plan.amountCents), reference }),
      refundedSoFar: t('refundedSoFar', {
        refunded: money(refundedCents),
        total: money(order.totalCents)
      }),
      viewOrders: t('viewOrders'),
      footer: t('footer')
    },
    customerLocale
  );
  const sent = await sendEmail({
    to: order.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    cc: getEmailConfig().ownerNotificationEmail
  });
  if (sent.sent) {
    await supabase.rpc('mark_order_refund_emailed', { p_refund_id: refundId });
  }

  return {
    ok: true,
    amountCents: plan.amountCents,
    currency: order.currency,
    kind: plan.kind,
    stripeRefundId,
    email: sent.sent ? 'sent' : sent.reason,
    emailError: sent.sent ? undefined : sent.error
  };
}
