import 'server-only';

import { getTranslations } from 'next-intl/server';

import { DEFAULT_LOCALE } from '@/i18n/config';
import type { EmailBrand, TransactionalKind } from './brand';
import type { TransactionalOptions } from './layout';
import { renderOrderConfirmation, type RenderedEmail } from './orderConfirmation';
import { renderRefundNotification } from './refundNotification';
import { renderShippingNotification } from './shippingNotification';
import { formatPrice } from '../format';

/**
 * The three customer emails for an imaginary order, in a given language and
 * brand. The settings page previews them and "send me a sample" posts them
 * to the owner, so the wording and the brand can be checked before a
 * customer ever sees them. Same renderers and the same Email.* strings as
 * the real sends; only the order is made up.
 */

const REFERENCE = 'A1B2C3D4';

function shop() {
  return {
    name: process.env.NEXT_PUBLIC_SHOP_NAME?.trim() || 'Our shop',
    url: process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '') || null
  };
}

export async function renderSampleEmail(kind: TransactionalKind, locale: string, brand: EmailBrand): Promise<RenderedEmail> {
  const { name: shopName, url: siteUrl } = shop();
  const ts = await getTranslations({ locale, namespace: 'Admin.email.settings.brand' });
  const options: TransactionalOptions = { brand, shopUrl: siteUrl, defaultLocale: DEFAULT_LOCALE };
  const ordersUrl = siteUrl ? `${siteUrl}/${locale}/account/orders` : 'https://example.com/account/orders';
  const items = [
    { productName: ts('sampleProductOne'), unitPriceCents: 1200, quantity: 2 },
    { productName: ts('sampleProductTwo'), unitPriceCents: 1000, quantity: 1 }
  ];
  const shipping = { name: ts('sampleCustomer'), line1: ts('sampleStreet'), postalCode: '10115', city: 'Berlin', country: 'DE' };
  const currency = 'EUR';
  const money = (cents: number) => formatPrice(cents, currency, locale);

  switch (kind) {
    case 'confirmation': {
      const t = await getTranslations({ locale, namespace: 'Email.confirmation' });
      return renderOrderConfirmation(
        { reference: REFERENCE, currency, subtotalCents: 3400, shippingCents: 490, totalCents: 3890, shopName, items, shipping, orderUrl: ordersUrl },
        {
          subject: t('subject', { shop: shopName, reference: REFERENCE }),
          headline: t('headline'),
          orderLabel: t('order', { reference: REFERENCE }),
          subtotal: t('subtotal'),
          shipping: t('shipping'),
          discount: t('discount'),
          total: t('total'),
          addressHeading: t('address'),
          viewOrder: t('viewOrder'),
          footer: t('footer')
        },
        locale,
        options
      );
    }
    case 'shipping': {
      const t = await getTranslations({ locale, namespace: 'Email.shipping' });
      return renderShippingNotification(
        {
          reference: REFERENCE,
          shopName,
          currency,
          items: items.map(({ productName, quantity }) => ({ productName, quantity })),
          shipping,
          tracking: { carrier: 'DHL', number: '00340434161094000001', url: 'https://www.dhl.com/en/express/tracking.html?AWB=00340434161094000001' },
          orderUrl: ordersUrl
        },
        {
          subject: t('subject', { shop: shopName, reference: REFERENCE }),
          headline: t('headline'),
          intro: t('intro', { reference: REFERENCE }),
          trackingHeading: t('tracking'),
          carrierLabel: t('carrier'),
          numberLabel: t('trackingNumber'),
          trackButton: t('track'),
          itemsHeading: t('items'),
          addressHeading: t('address'),
          viewOrders: t('viewOrders'),
          footer: t('footer')
        },
        locale,
        options
      );
    }
    case 'refund': {
      const t = await getTranslations({ locale, namespace: 'Email.refund' });
      const amount = 1200;
      const total = 3890;
      return renderRefundNotification(
        {
          reference: REFERENCE,
          shopName,
          currency,
          amountCents: amount,
          totalCents: total,
          refundedCents: amount,
          items: [{ productName: ts('sampleProductOne'), quantity: 1, amountCents: amount }],
          reason: ts('sampleRefundReason'),
          orderUrl: ordersUrl,
          customerName: ts('sampleCustomer')
        },
        {
          subject: t('subject', { shop: shopName, amount: money(amount), reference: REFERENCE }),
          headlineFull: t('headlineFull'),
          headlinePartial: t('headlinePartial'),
          summaryFull: t('summaryFull', { total: money(total), reference: REFERENCE }),
          summaryPartial: t('summaryPartial', { amount: money(amount), reference: REFERENCE }),
          refundedSoFar: t('refundedSoFar', { refunded: money(amount), total: money(total) }),
          viewOrders: t('viewOrders'),
          footer: t('footer')
        },
        locale,
        options
      );
    }
  }
}

/** The built-in intro and footer of each email in one locale, shown as placeholders in the admin. */
export async function builtInCopy(locale: string): Promise<Record<TransactionalKind, { intro: string | null; footer: string }>> {
  const confirmation = await getTranslations({ locale, namespace: 'Email.confirmation' });
  const shipping = await getTranslations({ locale, namespace: 'Email.shipping' });
  const refund = await getTranslations({ locale, namespace: 'Email.refund' });
  return {
    confirmation: { intro: null, footer: confirmation('footer') },
    shipping: { intro: shipping('intro', { reference: REFERENCE }), footer: shipping('footer') },
    refund: { intro: null, footer: refund('footer') }
  };
}
