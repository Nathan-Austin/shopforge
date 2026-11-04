import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { listOrders, orderReference, MANUAL_ORDER_STATUSES } from '@/lib/orders/service';
import { hasTracking, normalizeTracking } from '@/lib/orders/notifications';
import { formatPrice } from '@/lib/format';
import { requireShopOwner } from '../lib/auth';
import {
  sendShippingEmail,
  updateOrderStatus,
  type OrderNotice
} from '../actions/updateOrderStatus';

export const dynamic = 'force-dynamic';

export default async function AdminOrdersPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ notice?: string; detail?: string }>;
}) {
  const { locale } = await params;
  const { notice, detail } = await searchParams;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin' });
  const tStatus = await getTranslations({ locale, namespace: 'Account' });

  // The owner's RLS policy returns every order.
  const orders = await listOrders(supabase, { limit: 200 });
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  // A form action must return void; the result is surfaced by the
  // re-rendered page rather than a message.
  async function setStatus(formData: FormData) {
    'use server';
    await updateOrderStatus({ locale }, formData);
  }
  async function sendShipping(formData: FormData) {
    'use server';
    await sendShippingEmail({ locale }, formData);
  }

  // The outcome of the last action, carried in the URL by the redirect.
  const noticeText = ((): { text: string; tone: 'ok' | 'bad' } | null => {
    switch (notice as OrderNotice | undefined) {
      case 'status_saved':
        return { text: t('orders.statusSaved'), tone: 'ok' };
      case 'shipping_sent':
        return { text: t('orders.shippingEmailSent', { email: detail ?? '' }), tone: 'ok' };
      case 'shipping_off':
        return { text: t('orders.shippingEmailOff'), tone: 'bad' };
      case 'shipping_failed':
        return { text: t('orders.shippingEmailFailed', { error: detail ?? '' }), tone: 'bad' };
      case 'status_failed':
        return { text: t('orders.statusFailed', { error: detail ?? '' }), tone: 'bad' };
      case 'not_authorized':
        return { text: t('refund.errors.not_authorized'), tone: 'bad' };
      default:
        return null;
    }
  })();
  const inputClass = 'rounded-md border border-border bg-white px-2 py-1 text-sm';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{t('orders.heading')}</h2>
        <p className="text-sm text-stone-600">{t('orders.subheading')}</p>
        <p className="text-sm text-stone-600">{t('orders.autoEmailHint')}</p>
      </div>

      {noticeText && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            noticeText.tone === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {noticeText.text}
        </p>
      )}

      {orders.length === 0 ? (
        <p className="rounded-lg border border-border bg-white p-6 text-center text-stone-600">
          {t('orders.empty')}
        </p>
      ) : (
        <ul className="space-y-4">
          {orders.map((order) => (
            <li key={order.id} className="rounded-lg border border-border bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold">
                    {t('orders.order', { number: orderReference(order) })}
                  </h3>
                  <p className="text-sm text-stone-600">
                    {dateFormat.format(new Date(order.createdAt))}
                  </p>
                  <p className="mt-1 text-sm">{order.email}</p>
                  <Link
                    href={`/${locale}/admin/orders/${order.id}`}
                    className="mt-1 inline-block text-sm font-medium text-emerald-700 underline"
                  >
                    {t('orders.details')}
                  </Link>
                  {order.shipping.line1 && (
                    <address className="mt-2 text-sm not-italic text-stone-600">
                      {order.shipping.name && <div>{order.shipping.name}</div>}
                      <div>{order.shipping.line1}</div>
                      {order.shipping.line2 && <div>{order.shipping.line2}</div>}
                      <div>
                        {[order.shipping.postalCode, order.shipping.city, order.shipping.region]
                          .filter(Boolean)
                          .join(' ')}
                      </div>
                      {order.shipping.country && <div>{order.shipping.country}</div>}
                    </address>
                  )}
                </div>

                <div className="space-y-3 text-sm">
                  <form action={setStatus} className="space-y-2">
                    <input type="hidden" name="order_id" value={order.id} />
                    <div className="flex items-center gap-2">
                      <label htmlFor={`status-${order.id}`} className="sr-only">
                        {t('orders.status')}
                      </label>
                      <select
                        id={`status-${order.id}`}
                        name="status"
                        defaultValue={order.status}
                        disabled={order.status === 'refunded'}
                        className={`${inputClass} disabled:opacity-60`}
                      >
                        {order.status === 'refunded' && (
                          <option value="refunded">{tStatus('status.refunded')}</option>
                        )}
                        {MANUAL_ORDER_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {tStatus(`status.${status}`)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={order.status === 'refunded'}
                        className="rounded-md bg-stone-900 px-3 py-1 font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
                      >
                        {t('orders.save')}
                      </button>
                    </div>

                    <fieldset className="space-y-1">
                      <legend className="text-xs text-stone-600">{t('orders.tracking')}</legend>
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          name="tracking_carrier"
                          defaultValue={order.tracking.carrier ?? ''}
                          placeholder={t('orders.carrier')}
                          aria-label={t('orders.carrier')}
                          className={`${inputClass} w-32`}
                        />
                        <input
                          type="text"
                          name="tracking_number"
                          defaultValue={order.tracking.number ?? ''}
                          placeholder={t('orders.trackingNumber')}
                          aria-label={t('orders.trackingNumber')}
                          className={`${inputClass} w-44`}
                        />
                        <input
                          type="url"
                          name="tracking_url"
                          defaultValue={order.tracking.url ?? ''}
                          placeholder={t('orders.trackingUrl')}
                          aria-label={t('orders.trackingUrl')}
                          className={`${inputClass} w-64`}
                        />
                      </div>
                      <p className="text-xs text-stone-500">{t('orders.trackingUrlHint')}</p>
                    </fieldset>
                  </form>

                  {order.status === 'fulfilled' && (
                    <div className="space-y-1 border-t border-stone-100 pt-2 text-xs text-stone-600">
                      {order.shippedAt && (
                        <p>{t('orders.shippedOn', { date: dateFormat.format(new Date(order.shippedAt)) })}</p>
                      )}
                      {hasTracking(normalizeTracking(order.tracking)) && (
                        <p>
                          {[order.tracking.carrier, order.tracking.number].filter(Boolean).join(' · ')}
                          {normalizeTracking(order.tracking).url && (
                            <>
                              {' '}
                              <a
                                href={normalizeTracking(order.tracking).url ?? '#'}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                {t('orders.trackingUrl')}
                              </a>
                            </>
                          )}
                        </p>
                      )}
                      <p className={order.shippingNotifiedAt ? '' : 'text-amber-700'}>
                        {order.shippingNotifiedAt
                          ? t('orders.customerNotified', {
                              date: dateFormat.format(new Date(order.shippingNotifiedAt))
                            })
                          : t('orders.customerNotNotified')}
                      </p>
                      <form action={sendShipping}>
                        <input type="hidden" name="order_id" value={order.id} />
                        <button type="submit" className="underline hover:text-stone-900">
                          {order.shippingNotifiedAt
                            ? t('orders.resendShippingEmail')
                            : t('orders.sendShippingEmail')}
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              </div>

              <table className="mt-4 w-full text-sm">
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
                      <td className="py-1.5 text-right">
                        {formatPrice(item.unitPriceCents * item.quantity, order.currency, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border font-semibold">
                  <tr>
                    <td className="pt-2">{t('orders.total')}</td>
                    <td className="pt-2 text-right">
                      {formatPrice(order.totalCents, order.currency, locale)}
                    </td>
                  </tr>
                  {order.discountCents > 0 && (
                    <tr className="font-normal text-emerald-700">
                      <td colSpan={2} className="pt-1 text-right">
                        {t('orders.discount', { code: order.discountCode ?? '' })}: −
                        {formatPrice(order.discountCents, order.currency, locale)}
                      </td>
                    </tr>
                  )}
                  {order.refundedCents > 0 && (
                    <tr className="font-normal text-red-700">
                      <td colSpan={2} className="pt-1 text-right">
                        {t('orders.refundedSoFar', {
                          amount: formatPrice(order.refundedCents, order.currency, locale)
                        })}
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
