/**
 * The shipping notification email.
 *
 * Pure like the others, with one difference: the wording comes in as
 * `strings`, already translated into the customer's language by the caller
 * (next-intl's `Email.shipping` namespace), so the same template serves
 * every locale and can be tested with a plain fixture.
 */

import { escapeHtml, type RenderedEmail } from './orderConfirmation';

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

function addressLines(address: ShippingAddress): string[] {
  return [
    address.name,
    address.line1,
    address.line2,
    [address.postalCode, address.city, address.region].filter(Boolean).join(' ') || null,
    address.country
  ].filter((line): line is string => Boolean(line && line.trim()));
}

export function renderShippingNotification(
  order: ShippingNotification,
  strings: ShippingEmailStrings,
  locale = 'en'
): RenderedEmail {
  // Only http(s) links are rendered, whatever the row says.
  const trackingUrl = /^https?:\/\//i.test(order.tracking?.url ?? '') ? order.tracking?.url ?? null : null;
  const carrier = order.tracking?.carrier?.trim() || null;
  const number = order.tracking?.number?.trim() || null;
  const hasTracking = Boolean(trackingUrl || carrier || number);
  const dir = ['ar', 'fa', 'he', 'ur'].includes(locale.split('-')[0]) ? 'rtl' : 'ltr';

  const trackingHtml = hasTracking
    ? `<h2 style="font-size:14px;text-transform:uppercase;color:#666;margin:24px 0 8px;">${escapeHtml(strings.trackingHeading)}</h2>
       <p style="margin:0;line-height:1.6;">
         ${carrier ? `${escapeHtml(strings.carrierLabel)}: ${escapeHtml(carrier)}<br>` : ''}
         ${number ? `${escapeHtml(strings.numberLabel)}: <strong>${escapeHtml(number)}</strong>` : ''}
       </p>
       ${
         trackingUrl
           ? `<p style="margin:16px 0 0;">
         <a href="${escapeHtml(trackingUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">${escapeHtml(strings.trackButton)}</a>
       </p>`
           : ''
       }`
    : '';

  const itemRows = order.items
    .map((item) => {
      const variant = variantLabel(item);
      return `<li style="padding:4px 0;">${item.quantity} × ${escapeHtml(item.productName)}${
        variant ? ` <span style="color:#666;">(${escapeHtml(variant)})</span>` : ''
      }</li>`;
    })
    .join('');

  const address = order.shipping ? addressLines(order.shipping) : [];
  const addressHtml = address.length
    ? `<h2 style="font-size:14px;text-transform:uppercase;color:#666;margin:24px 0 8px;">${escapeHtml(strings.addressHeading)}</h2>
       <p style="margin:0;line-height:1.5;">${address.map(escapeHtml).join('<br>')}</p>`
    : '';

  const ordersHtml = order.orderUrl
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(order.orderUrl)}" style="color:#111;">${escapeHtml(strings.viewOrders)}</a></p>`
    : '';

  const html = `<!doctype html>
<html dir="${dir}" lang="${escapeHtml(locale)}">
  <body style="margin:0;padding:24px;background:#f6f6f6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;">
      <h1 style="font-size:20px;margin:0 0 8px;">${escapeHtml(strings.headline)}</h1>
      <p style="margin:0 0 4px;color:#444;">${escapeHtml(order.shopName)}</p>
      <p style="margin:0 0 16px;font-size:15px;">${escapeHtml(strings.intro)}</p>

      ${trackingHtml}

      <h2 style="font-size:14px;text-transform:uppercase;color:#666;margin:24px 0 8px;">${escapeHtml(strings.itemsHeading)}</h2>
      <ul style="margin:0;padding-inline-start:20px;font-size:15px;">${itemRows}</ul>

      ${addressHtml}
      ${ordersHtml}

      <p style="margin:24px 0 0;color:#888;font-size:13px;">${escapeHtml(strings.footer)}</p>
    </div>
  </body>
</html>`;

  const textLines = [strings.headline, order.shopName, '', strings.intro];
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
  textLines.push('', strings.footer);

  return { subject: strings.subject, html, text: textLines.join('\n') };
}
