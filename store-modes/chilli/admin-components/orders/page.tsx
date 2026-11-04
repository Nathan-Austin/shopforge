import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { listOrders, orderReference, MANUAL_ORDER_STATUSES } from '@/lib/orders/service';
import { formatPrice } from '@/lib/format';
import { requireShopOwner } from '../lib/auth';
import { updateOrderStatus } from '../actions/updateOrderStatus';

export const dynamic = 'force-dynamic';

export default async function AdminOrdersPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">{t('orders.heading')}</h2>
        <p className="text-sm text-stone-600">{t('orders.subheading')}</p>
      </div>

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

                <form action={setStatus} className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="order_id" value={order.id} />
                  <label htmlFor={`status-${order.id}`} className="sr-only">
                    {t('orders.status')}
                  </label>
                  <select
                    id={`status-${order.id}`}
                    name="status"
                    defaultValue={order.status}
                    disabled={order.status === 'refunded'}
                    className="rounded-md border border-border bg-white px-2 py-1 disabled:opacity-60"
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
                    className="rounded-md bg-stone-900 px-3 py-1 font-semibold text-white hover:bg-stone-700"
                  >
                    {t('orders.save')}
                  </button>
                </form>
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
