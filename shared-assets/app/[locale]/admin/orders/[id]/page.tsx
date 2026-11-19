import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { formatPrice } from '@/lib/format';
import { refundedQuantities, remainingRefundableCents } from '@/lib/orders/refunds';
import {
  getOrderById,
  isDisputeOpen,
  listOrderDisputes,
  listOrderRefunds,
  orderReference,
  REFUNDABLE_ORDER_STATUSES,
  type OrderStatus
} from '@/lib/orders/service';
import { refundOrder } from '../../actions/refundOrder';
import RefundForm from '../../components/RefundForm';
import { requireShopOwner } from '../../lib/auth';

export const dynamic = 'force-dynamic';

/** One order for the owner: what was bought, what has been refunded, and the refund form. */
export default async function AdminOrderPage({
  params
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin' });
  const tStatus = await getTranslations({ locale, namespace: 'Account' });

  const order = await getOrderById(supabase, id);
  if (!order) notFound();

  const refunds = await listOrderRefunds(supabase, order.id);
  const disputes = await listOrderDisputes(supabase, order.id);
  const alreadyRefunded = refundedQuantities(refunds);
  const remaining = remainingRefundableCents(order);
  const refundable = REFUNDABLE_ORDER_STATUSES.includes(order.status as OrderStatus);
  // The database refuses a refund while a dispute is live (0009_disputes);
  // say so here rather than letting the owner find out from an error.
  const openDispute = disputes.find(isDisputeOpen) ?? null;
  const money = (cents: number) => formatPrice(cents, order.currency, locale);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const tDispute = await getTranslations({ locale, namespace: 'Admin.dispute' });
  // Stripe's status list grows; an unknown one shows as itself rather than
  // breaking the page with a missing-translation error.
  const KNOWN_DISPUTE_STATUSES = [
    'warning_needs_response',
    'warning_under_review',
    'warning_closed',
    'needs_response',
    'under_review',
    'won',
    'lost'
  ];
  const disputeStatus = (status: string) =>
    KNOWN_DISPUTE_STATUSES.includes(status) ? tDispute(`statuses.${status}`) : status;

  const action = refundOrder.bind(null, { locale, orderId: order.id });

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/${locale}/admin/orders`} className="text-sm underline">
          {t('refund.backToOrders')}
        </Link>
        <h2 className="mt-2 text-xl font-bold">
          {t('orders.order', { number: orderReference(order) })}
        </h2>
        <p className="text-sm text-stone-600">
          {dateFormat.format(new Date(order.createdAt))} · {order.email} ·{' '}
          {tStatus(`status.${order.status}`)}
        </p>
      </div>

      <table className="w-full max-w-2xl text-sm">
        <tbody className="divide-y divide-stone-100">
          {order.items.map((item) => (
            <tr key={item.id}>
              <td className="py-1.5">
                {item.quantity} × {item.productName}
                {(item.selectedSize || item.selectedColor) && (
                  <span className="text-stone-500">
                    {' '}
                    ({[item.selectedSize, item.selectedColor].filter(Boolean).join(' / ')})
                  </span>
                )}
              </td>
              <td className="py-1.5 text-right">{money(item.unitPriceCents * item.quantity)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border">
          <tr>
            <td className="pt-2 font-semibold">{t('orders.total')}</td>
            <td className="pt-2 text-right font-semibold">{money(order.totalCents)}</td>
          </tr>
          {order.discountCents > 0 && (
            <tr className="text-emerald-700">
              <td colSpan={2} className="pt-1 text-right">
                {t('orders.discount', { code: order.discountCode ?? '' })}: −{money(order.discountCents)}
              </td>
            </tr>
          )}
          {order.refundedCents > 0 && (
            <tr className="text-red-700">
              <td colSpan={2} className="pt-1 text-right">
                {t('orders.refundedSoFar', { amount: money(order.refundedCents) })}
              </td>
            </tr>
          )}
        </tfoot>
      </table>

      {disputes.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">{tDispute('heading')}</h3>
          <ul className="space-y-3">
            {disputes.map((dispute) => {
              const open = isDisputeOpen(dispute);
              const amount = formatPrice(dispute.amountCents, dispute.currency, locale);
              return (
                <li
                  key={dispute.id}
                  className={`space-y-1 rounded-lg border p-3 text-sm ${
                    open || dispute.status === 'lost'
                      ? 'border-red-300 bg-red-50 text-red-900'
                      : 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  }`}
                >
                  <p className="font-semibold">
                    {open
                      ? tDispute('openNotice', { amount })
                      : dispute.status === 'won'
                        ? tDispute('wonNotice', { amount })
                        : tDispute('lostNotice', { amount })}
                  </p>
                  {open && (
                    <p>
                      {dispute.evidenceDueAt
                        ? tDispute('deadline', {
                            date: dateFormat.format(new Date(dispute.evidenceDueAt))
                          })
                        : tDispute('noDeadline')}
                    </p>
                  )}
                  {dispute.reason && <p>{tDispute('reason', { reason: dispute.reason })}</p>}
                  {open && <p>{tDispute('answerInStripe')}</p>}
                  <p className="text-xs opacity-75">
                    {disputeStatus(dispute.status)} ·{' '}
                    {tDispute('opened', { date: dateFormat.format(new Date(dispute.openedAt)) })}
                    {dispute.closedAt && (
                      <>
                        {' · '}
                        {tDispute('closed', {
                          date: dateFormat.format(new Date(dispute.closedAt))
                        })}
                      </>
                    )}
                    {' · '}
                    {dispute.stripeDisputeId}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold">{t('refund.heading')}</h3>
          <p className="text-sm text-stone-600">{t('refund.subheading')}</p>
        </div>

        {openDispute ? (
          <p className="text-sm text-stone-600">{tDispute('refundBlocked')}</p>
        ) : !refundable ? (
          <p className="text-sm text-stone-600">{t('refund.notRefundable')}</p>
        ) : remaining <= 0 ? (
          <p className="text-sm text-stone-600">{t('refund.nothingLeft')}</p>
        ) : !order.stripePaymentIntentId ? (
          <p className="text-sm text-stone-600">{t('refund.noPayment')}</p>
        ) : (
          <RefundForm
            locale={locale}
            currency={order.currency}
            totalCents={order.totalCents}
            refundedCents={order.refundedCents}
            items={order.items.map((item) => ({
              id: item.id,
              productName: item.productName,
              unitPriceCents: item.unitPriceCents,
              quantity: item.quantity,
              refundedQuantity: alreadyRefunded.get(item.id) ?? 0
            }))}
            action={action}
          />
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold">{t('refund.history')}</h3>
        {refunds.length === 0 ? (
          <p className="text-sm text-stone-600">{t('refund.historyEmpty')}</p>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-lg border border-border bg-white text-sm">
            {refunds.map((refund) => (
              <li key={refund.id} className="space-y-1 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {formatPrice(refund.amountCents, refund.currency, locale)}
                    <span className="font-normal text-stone-500">
                      {' '}
                      · {t(`refund.kinds.${refund.kind}`, { percent: refund.percent ?? 0 })}
                    </span>
                  </span>
                  <span className="text-stone-600">
                    {dateFormat.format(new Date(refund.createdAt))} ·{' '}
                    {t(`refund.statuses.${refund.status}`)}
                  </span>
                </div>
                {refund.items.length > 0 && (
                  <p className="text-stone-600">
                    {refund.items.map((item) => `${item.quantity} × ${item.productName}`).join(', ')}
                  </p>
                )}
                {refund.reason && <p className="text-stone-600">{refund.reason}</p>}
                {refund.failureMessage && <p className="text-red-700">{refund.failureMessage}</p>}
                <p className="text-xs text-stone-500">
                  {refund.stripeRefundId && <span>{refund.stripeRefundId} · </span>}
                  {refund.status === 'succeeded' &&
                    (refund.emailSentAt ? t('refund.customerEmailed') : t('refund.customerNotEmailed'))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
