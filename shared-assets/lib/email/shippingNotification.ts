/**
 * The shipping notification email.
 *
 * Pure like the others, with one difference: the wording comes in as
 * `strings`, already translated into the customer's language by the caller
 * (next-intl's `Email.shipping` namespace), so the same template serves
 * every locale and can be tested with a plain fixture. The frame comes from
 * the shop's email brand (./brand, ./layout).
 */

import { escapeHtml } from './escape';
import {
  copyFor,
  emailButton,
  emailHeading,
  emailStyles,
  footerAddressFor,
  renderTransactionalEmail,
  type TransactionalOptions
} from './layout';
import { addressLines, type RenderedEmail } from './orderConfirmation';

export interface ShippingItem {
  productName: string;
  quantity: number;
  selectedSize?: string | null;
  selectedColor?: string | null;
}

export interface ShippingAddress {
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  region?: string | null;
  country?: string | null;
}

export interface ShippingNotification {
  reference: string;
  shopName: string;
  currency: string;
  items: ShippingItem[];
  shipping?: ShippingAddress | null;
  tracking?: { carrier?: string | null; number?: string | null; url?: string | null } | null;
  /** Absolute URL to the customer's orders, if the shop knows its address. */
  orderUrl?: string | null;
}

/** Translated wording. Placeholders are already filled in by the caller. */
export interface ShippingEmailStrings {
  subject: string;
  headline: string;
  intro: string;
  trackingHeading: string;
  carrierLabel: string;
  numberLabel: string;
  trackButton: string;
  itemsHeading: string;
  addressHeading: string;
  viewOrders: string;
  footer: string;
}

function variantLabel(item: ShippingItem): string {
  return [item.selectedSize, item.selectedColor].filter(Boolean).join(' / ');
}

export function renderShippingNotification(
  order: ShippingNotification,
  strings: ShippingEmailStrings,
  locale = 'en',
  options?: TransactionalOptions
): RenderedEmail {
  const styles = emailStyles(options?.brand);
  const copy = copyFor(options, 'shipping', locale);
  const intro = copy.intro ?? strings.intro;
  const footer = copy.footer ?? strings.footer;
  // Only http(s) links are rendered, whatever the row says.
  const trackingUrl = /^https?:\/\//i.test(order.tracking?.url ?? '') ? order.tracking?.url ?? null : null;
  const carrier = order.tracking?.carrier?.trim() || null;
  const number = order.tracking?.number?.trim() || null;
  const hasTracking = Boolean(trackingUrl || carrier || number);

  const trackingHtml = hasTracking
    ? `${emailHeading(strings.trackingHeading, styles)}
       <p style="margin:0;line-height:1.6;">
         ${carrier ? `${escapeHtml(strings.carrierLabel)}: ${escapeHtml(carrier)}<br>` : ''}
         ${number ? `${escapeHtml(strings.numberLabel)}: <strong>${escapeHtml(number)}</strong>` : ''}
       </p>
       ${trackingUrl ? emailButton(strings.trackButton, trackingUrl, styles) : ''}`
    : '';

  const itemRows = order.items
    .map((item) => {
      const variant = variantLabel(item);
      return `<li style="padding:4px 0;">${item.quantity} × ${escapeHtml(item.productName)}${
        variant ? ` <span style="${styles.muted}">(${escapeHtml(variant)})</span>` : ''
      }</li>`;
    })
    .join('');

  const address = order.shipping ? addressLines(order.shipping) : [];
  const addressHtml = address.length
    ? `${emailHeading(strings.addressHeading, styles)}
       <p style="margin:0;line-height:1.5;">${address.map(escapeHtml).join('<br>')}</p>`
    : '';

  const ordersHtml = order.orderUrl
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(order.orderUrl)}" style="${styles.link}">${escapeHtml(strings.viewOrders)}</a></p>`
    : '';

  const bodyHtml = `<h1 style="font-size:20px;line-height:1.3;margin:0 0 8px;">${escapeHtml(strings.headline)}</h1>
      <p style="margin:0 0 4px;${styles.muted}">${escapeHtml(order.shopName)}</p>
      <p style="margin:0 0 16px;font-size:15px;white-space:pre-line;">${escapeHtml(intro)}</p>

      ${trackingHtml}

      ${emailHeading(strings.itemsHeading, styles)}
      <ul style="margin:0;padding-inline-start:20px;font-size:15px;">${itemRows}</ul>

      ${addressHtml}
      ${ordersHtml}`;

  const textLines = [strings.headline, order.shopName, '', intro];
  if (hasTracking) {
    textLines.push('', strings.trackingHeading);
    if (carrier) textLines.push(`${strings.carrierLabel}: ${carrier}`);
    if (number) textLines.push(`${strings.numberLabel}: ${number}`);
    if (trackingUrl) textLines.push(`${strings.trackButton}: ${trackingUrl}`);
  }
  textLines.push(
    '',
    strings.itemsHeading,
    ...order.items.map((item) => {
      const variant = variantLabel(item);
      return `${item.quantity} x ${item.productName}${variant ? ` (${variant})` : ''}`;
    })
  );
  if (address.length) textLines.push('', strings.addressHeading, ...address);
  if (order.orderUrl) textLines.push('', `${strings.viewOrders}: ${order.orderUrl}`);

  const framed = renderTransactionalEmail({
    brand: options?.brand,
    locale,
    subject: strings.subject,
    shopName: order.shopName,
    shopUrl: options?.shopUrl,
    body: { html: bodyHtml, text: textLines.join('\n') },
    footerNote: footer,
    footerAddress: footerAddressFor(options, locale)
  });

  return { subject: strings.subject, html: framed.html, text: framed.text };
}
