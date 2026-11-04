/**
 * The refund notification email.
 *
 * Sent to the customer when the shop owner refunds some or all of an order,
 * with the owner in copy. Pure like the order confirmation: order in,
 * subject/HTML/text out, every customer- or owner-supplied string escaped.
 */

import { formatPrice } from '../format';
import { escapeHtml, type RenderedEmail } from './orderConfirmation';

export interface RefundNotificationItem {
  productName: string;
  quantity: number;
  amountCents: number;
}

export interface RefundNotification {
  reference: string;
  shopName: string;
  currency: string;
  /** This refund. */
  amountCents: number;
  /** The order's total, so the customer can see whether this is all of it. */
  totalCents: number;
  /** Refunded so far, this refund included. */
  refundedCents: number;
  /** Lines this refund covers; empty for a percentage or a figure. */
  items?: RefundNotificationItem[];
  /** The owner's note to the customer, if any. */
  reason?: string | null;
  /** Absolute URL to the customer's orders, if the shop knows its address. */
  orderUrl?: string | null;
}

export function renderRefundNotification(
  refund: RefundNotification,
  locale = 'en'
): RenderedEmail {
  const money = (cents: number) => formatPrice(cents, refund.currency, locale);
  const isFull = refund.refundedCents >= refund.totalCents;
  const items = refund.items ?? [];

  const headline = isFull ? 'Your order has been refunded' : 'A refund is on its way';
  const summary = isFull
    ? `We have refunded the full ${money(refund.totalCents)} for order ${refund.reference}.`
    : `We have refunded ${money(refund.amountCents)} of order ${refund.reference}.`;

  const itemRows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee;">${item.quantity} × ${escapeHtml(item.productName)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">${escapeHtml(money(item.amountCents))}</td>
        </tr>`
    )
    .join('');
  const itemsHtml = items.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:15px;margin-top:16px;"><tbody>${itemRows}
      </tbody></table>`
    : '';

  const reason = refund.reason?.trim();
  const reasonHtml = reason
    ? `<p style="margin:16px 0 0;padding:12px;background:#f6f6f6;border-radius:6px;color:#444;white-space:pre-line;">${escapeHtml(reason)}</p>`
    : '';

  const remainingHtml = isFull
    ? ''
    : `<p style="margin:16px 0 0;color:#666;">Refunded so far: ${escapeHtml(money(refund.refundedCents))} of ${escapeHtml(money(refund.totalCents))}.</p>`;

  const buttonHtml = refund.orderUrl
    ? `<p style="margin:24px 0;">
         <a href="${escapeHtml(refund.orderUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">View your orders</a>
       </p>`
    : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f6f6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;">
      <h1 style="font-size:20px;margin:0 0 8px;">${headline}</h1>
      <p style="margin:0 0 4px;color:#444;">${escapeHtml(refund.shopName)}</p>
      <p style="margin:0 0 16px;color:#666;">Order ${escapeHtml(refund.reference)}</p>

      <p style="margin:0;font-size:15px;">${escapeHtml(summary)}</p>
      ${itemsHtml}
      ${remainingHtml}
      ${reasonHtml}
      ${buttonHtml}

      <p style="margin:24px 0 0;color:#888;font-size:13px;">
        The money goes back to the card or account you paid with. Banks usually show it within 5 to 10 working days.
      </p>
    </div>
  </body>
</html>`;

  const textLines = [headline, refund.shopName, `Order ${refund.reference}`, '', summary];
  if (items.length) {
    textLines.push('', ...items.map((item) => `${item.quantity} x ${item.productName}  ${money(item.amountCents)}`));
  }
  if (!isFull) {
    textLines.push('', `Refunded so far: ${money(refund.refundedCents)} of ${money(refund.totalCents)}.`);
  }
  if (reason) textLines.push('', reason);
  if (refund.orderUrl) textLines.push('', `View your orders: ${refund.orderUrl}`);
  textLines.push(
    '',
    'The money goes back to the card or account you paid with. Banks usually show it within 5 to 10 working days.'
  );

  return {
    subject: `${refund.shopName}: refund of ${money(refund.amountCents)} for order ${refund.reference}`,
    html,
    text: textLines.join('\n')
  };
}
