/**
 * The order confirmation email.
 *
 * A pure function: it takes the order and returns the subject, HTML and
 * plain text. No network, no environment, so it can be unit tested and
 * previewed. Everything that came from a customer or a product name is
 * escaped before it reaches the HTML.
 */

import { formatPrice } from '../format';

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
  totalCents: number;
  items: ConfirmationItem[];
  shipping?: ConfirmationAddress | null;
  /** Absolute URL to the order, if the shop knows its own address. */
  orderUrl?: string | null;
  shopName: string;
}

/** Escape the five characters that can break out of HTML text or an attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function variantLabel(item: ConfirmationItem): string {
  return [item.selectedSize, item.selectedColor].filter(Boolean).join(' / ');
}

function addressLines(address: ConfirmationAddress): string[] {
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

export function renderOrderConfirmation(
  order: ConfirmationOrder,
  locale = 'en'
): RenderedEmail {
  const money = (cents: number) => formatPrice(cents, order.currency, locale);

  const itemRows = order.items
    .map((item) => {
      const variant = variantLabel(item);
      return `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee;">
            ${escapeHtml(item.productName)}
            ${variant ? `<br><span style="color:#666;font-size:13px;">${escapeHtml(variant)}</span>` : ''}
            <br><span style="color:#666;font-size:13px;">${item.quantity} × ${escapeHtml(money(item.unitPriceCents))}</span>
          </td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">
            ${escapeHtml(money(item.unitPriceCents * item.quantity))}
          </td>
        </tr>`;
    })
    .join('');

  const address = order.shipping ? addressLines(order.shipping) : [];
  const addressHtml = address.length
    ? `<h2 style="font-size:14px;text-transform:uppercase;color:#666;margin:24px 0 8px;">Delivery address</h2>
       <p style="margin:0;line-height:1.5;">${address.map(escapeHtml).join('<br>')}</p>`
    : '';

  const buttonHtml = order.orderUrl
    ? `<p style="margin:24px 0;">
         <a href="${escapeHtml(order.orderUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">View your order</a>
       </p>`
    : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f6f6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;">
      <h1 style="font-size:20px;margin:0 0 8px;">Thank you for your order</h1>
      <p style="margin:0 0 4px;color:#444;">${escapeHtml(order.shopName)}</p>
      <p style="margin:0 0 24px;color:#666;">Order ${escapeHtml(order.reference)}</p>

      <table style="width:100%;border-collapse:collapse;font-size:15px;">
        <tbody>${itemRows}
        </tbody>
      </table>

      <table style="width:100%;border-collapse:collapse;font-size:15px;margin-top:12px;">
        <tbody>
          <tr><td style="padding:2px 0;color:#666;">Subtotal</td><td style="padding:2px 0;text-align:right;">${escapeHtml(money(order.subtotalCents))}</td></tr>
          <tr><td style="padding:2px 0;color:#666;">Shipping</td><td style="padding:2px 0;text-align:right;">${escapeHtml(money(order.shippingCents))}</td></tr>
          <tr><td style="padding:8px 0 0;font-weight:bold;">Total</td><td style="padding:8px 0 0;text-align:right;font-weight:bold;">${escapeHtml(money(order.totalCents))}</td></tr>
        </tbody>
      </table>

      ${addressHtml}
      ${buttonHtml}

      <p style="margin:24px 0 0;color:#888;font-size:13px;">
        We will email you again when your order ships.
      </p>
    </div>
  </body>
</html>`;

  const textLines = [
    'Thank you for your order',
    order.shopName,
    `Order ${order.reference}`,
    '',
    ...order.items.map((item) => {
      const variant = variantLabel(item);
      return `${item.quantity} x ${item.productName}${variant ? ` (${variant})` : ''}  ${money(
        item.unitPriceCents * item.quantity
      )}`;
    }),
    '',
    `Subtotal: ${money(order.subtotalCents)}`,
    `Shipping: ${money(order.shippingCents)}`,
    `Total: ${money(order.totalCents)}`
  ];

  if (address.length) {
    textLines.push('', 'Delivery address:', ...address);
  }
  if (order.orderUrl) {
    textLines.push('', `View your order: ${order.orderUrl}`);
  }
  textLines.push('', 'We will email you again when your order ships.');

  return {
    subject: `${order.shopName}: order ${order.reference} confirmed`,
    html,
    text: textLines.join('\n')
  };
}
