import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getTranslations } from 'next-intl/server';

import { renderShippingNotification } from '@/lib/email/shippingNotification';
import { sendEmail } from '@/lib/email/send';
import { normalizeTracking } from './notifications';
import { orderReference, type Order } from './service';

export type ShippingNotifyResult =
  | { sent: true }
  | { sent: false; reason: 'not-configured' | 'failed'; error?: string };

/**
 * Emails the customer that their order has shipped, in the language they
 * checked out in, and records that it went. No guard here on purpose: the
 * automatic path asks notificationForStatusChange() first, and the manual
 * "resend" button is the owner's deliberate choice.
 */
export async function sendShippingNotification(
  supabase: SupabaseClient,
  order: Order,
  fallbackLocale: string
): Promise<ShippingNotifyResult> {
  const locale = order.locale || fallbackLocale;
  const t = await getTranslations({ locale, namespace: 'Email.shipping' });
  const shopName = process.env.NEXT_PUBLIC_SHOP_NAME || 'Our shop';
  const reference = orderReference(order);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? null;

  const email = renderShippingNotification(
    {
      reference,
      shopName,
      currency: order.currency,
      items: order.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        selectedSize: item.selectedSize,
        selectedColor: item.selectedColor
      })),
      shipping: order.shipping,
      tracking: normalizeTracking(order.tracking),
      orderUrl: siteUrl ? `${siteUrl}/${locale}/account/orders` : null
    },
    {
      subject: t('subject', { shop: shopName, reference }),
      headline: t('headline'),
      intro: t('intro', { reference }),
      trackingHeading: t('tracking'),
      carrierLabel: t('carrier'),
      numberLabel: t('trackingNumber'),
      trackButton: t('track'),
      itemsHeading: t('items'),
      addressHeading: t('address'),
      viewOrders: t('viewOrders'),
      footer: t('footer')
    },
    locale
  );

  const result = await sendEmail({
    to: order.email,
    subject: email.subject,
    html: email.html,
    text: email.text
  });

  if (result.sent) {
    await supabase.rpc('mark_order_shipping_notified', { p_order_id: order.id });
    return { sent: true };
  }
  return { sent: false, reason: result.reason, error: result.error };
}
