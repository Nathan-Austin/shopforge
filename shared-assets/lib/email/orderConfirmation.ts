/**
 * The order confirmation email.
 *
 * A pure function: it takes the order and the translated wording and
 * returns the subject, HTML and plain text. No network, no environment, so
 * it can be unit tested and previewed. Everything that came from a
 * customer or a product name is escaped before it reaches the HTML. The
 * frame (logo, colours, font, footer address) comes from the shop's email
 * brand, see ./brand and ./layout.
 */

import { formatPrice } from '../format';
import { escapeHtml } from './escape';
import { firstNameOf } from './wordingTags';
import {
  copyFor,
  emailButton,
  emailHeading,
  emailParagraph,
  emailStyles,
  footerAddressFor,
  renderTransactionalEmail,
  type TransactionalOptions
} from './layout';

export { escapeHtml };

export interface ConfirmationItem {
  productName: string;
  unitPriceCents: number;
  quantity: number;
  selectedSize?: string | null;
  selectedColor?: string | null;
}

export interface ConfirmationAddress {
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  region?: string | null;
  country?: string | null;
}

export interface ConfirmationOrder {
  reference: string;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  /** Taken off by a promo code; shown as a line when above zero. */
  discountCents?: number;
  discountCode?: string | null;
  totalCents: number;
  items: ConfirmationItem[];
  shipping?: ConfirmationAddress | null;
  /** Absolute URL to the order, if the shop knows its own address. */
  orderUrl?: string | null;
  shopName: string;
}

function variantLabel(item: ConfirmationItem): string {
  return [item.selectedSize, item.selectedColor].filter(Boolean).join(' / ');
}

export function addressLines(address: ConfirmationAddress): string[] {
  return [
    address.name,
    address.line1,
    address.line2,
    [address.postalCode, address.city, address.region].filter(Boolean).join(' ') || null,
    address.country
  ].filter((line): line is string => Boolean(line && line.trim()));
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Translated wording, from the Email.confirmation namespace. Placeholders
 * are already filled in by the caller, so the template stays pure.
 */
export interface ConfirmationEmailStrings {
  subject: string;
  headline: string;
  /** e.g. "Order A1B2C3D4" */
  orderLabel: string;
  subtotal: string;
  shipping: string;
  discount: string;
  total: string;
  addressHeading: string;
  viewOrder: string;
  /** The built-in last line; the owner's wording in the brand replaces it. */
  footer: string;
}

export function renderOrderConfirmation(
  order: ConfirmationOrder,
  strings: ConfirmationEmailStrings,
  locale = 'en',
  options?: TransactionalOptions
): RenderedEmail {
  const styles = emailStyles(options?.brand);
  const copy = copyFor(options, 'confirmation', locale, {
    'customer.first_name': firstNameOf(order.shipping?.name),
    'order.reference': order.reference,
    'shop.name': order.shopName
  });
  const footer = copy.footer ?? strings.footer;
  const money = (cents: number) => formatPrice(cents, order.currency, locale);
  const discount = order.discountCents ?? 0;
  const discountLabel = order.discountCode
    ? `${strings.discount} (${order.discountCode})`
    : strings.discount;

  const itemRows = order.items
    .map((item) => {
      const variant = variantLabel(item);
      return `
        <tr>
          <td style="padding:8px 0;${styles.rule}">
            ${escapeHtml(item.productName)}
            ${variant ? `<br><span style="font-size:13px;${styles.muted}">${escapeHtml(variant)}</span>` : ''}
            <br><span style="font-size:13px;${styles.muted}">${item.quantity} × ${escapeHtml(money(item.unitPriceCents))}</span>
          </td>
          <td style="padding:8px 0;text-align:end;white-space:nowrap;${styles.rule}">
            ${escapeHtml(money(item.unitPriceCents * item.quantity))}
          </td>
        </tr>`;
    })
    .join('');

  const address = order.shipping ? addressLines(order.shipping) : [];
  const addressHtml = address.length
    ? `${emailHeading(strings.addressHeading, styles)}
       <p style="margin:0;line-height:1.5;">${address.map(escapeHtml).join('<br>')}</p>`
    : '';

  const buttonHtml = order.orderUrl ? emailButton(strings.viewOrder, order.orderUrl, styles) : '';

  const discountRow =
    discount > 0
      ? `
          <tr><td style="padding:2px 0;${styles.muted}">${escapeHtml(discountLabel)}</td><td style="padding:2px 0;text-align:end;">−${escapeHtml(money(discount))}</td></tr>`
      : '';

  const bodyHtml = `<h1 style="font-size:20px;line-height:1.3;margin:0 0 8px;">${escapeHtml(strings.headline)}</h1>
      <p style="margin:0 0 4px;${styles.muted}">${escapeHtml(order.shopName)}</p>
      <p style="margin:0 0 24px;${styles.muted}">${escapeHtml(strings.orderLabel)}</p>
      ${copy.intro ? emailParagraph(copy.intro) : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:15px;">
        <tbody>${itemRows}
        </tbody>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:15px;margin-top:12px;">
        <tbody>
          <tr><td style="padding:2px 0;${styles.muted}">${escapeHtml(strings.subtotal)}</td><td style="padding:2px 0;text-align:end;">${escapeHtml(money(order.subtotalCents))}</td></tr>${discountRow}
          <tr><td style="padding:2px 0;${styles.muted}">${escapeHtml(strings.shipping)}</td><td style="padding:2px 0;text-align:end;">${escapeHtml(money(order.shippingCents))}</td></tr>
          <tr><td style="padding:8px 0 0;font-weight:bold;">${escapeHtml(strings.total)}</td><td style="padding:8px 0 0;text-align:end;font-weight:bold;">${escapeHtml(money(order.totalCents))}</td></tr>
        </tbody>
      </table>

      ${addressHtml}
      ${buttonHtml}`;

  const textLines = [
    strings.headline,
    order.shopName,
    strings.orderLabel,
    ...(copy.intro ? ['', copy.intro] : []),
    '',
    ...order.items.map((item) => {
      const variant = variantLabel(item);
      return `${item.quantity} x ${item.productName}${variant ? ` (${variant})` : ''}  ${money(
        item.unitPriceCents * item.quantity
      )}`;
    }),
    '',
    `${strings.subtotal}: ${money(order.subtotalCents)}`
  ];
  if (discount > 0) textLines.push(`${discountLabel}: -${money(discount)}`);
  textLines.push(`${strings.shipping}: ${money(order.shippingCents)}`, `${strings.total}: ${money(order.totalCents)}`);

  if (address.length) {
    textLines.push('', `${strings.addressHeading}:`, ...address);
  }
  if (order.orderUrl) {
    textLines.push('', `${strings.viewOrder}: ${order.orderUrl}`);
  }

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
