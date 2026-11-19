/**
 * The refund notification email.
 *
 * Sent to the customer when the shop owner refunds some or all of an order,
 * with the owner in copy. Pure like the order confirmation: order and the
 * translated wording in, subject/HTML/text out, every customer- or
 * owner-supplied string escaped. The frame comes from the shop's email
 * brand (./brand, ./layout).
 */

import { formatPrice } from '../format';
import { escapeHtml } from './escape';
import { emailButton, emailStyles, footerAddressFor, renderTransactionalEmail, type TransactionalOptions } from './layout';
import type { RenderedEmail } from './orderConfirmation';

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

/**
 * Translated wording, from the Email.refund namespace. The caller fills
 * the placeholders (amounts, reference), so the template stays pure.
 */
export interface RefundEmailStrings {
  subject: string;
  headlineFull: string;
  headlinePartial: string;
  /** "We have refunded the full {total} for order {reference}." */
  summaryFull: string;
  /** "We have refunded {amount} of order {reference}." */
  summaryPartial: string;
  /** "Refunded so far: {refunded} of {total}." */
  refundedSoFar: string;
  viewOrders: string;
  footer: string;
}

export function renderRefundNotification(
  refund: RefundNotification,
  strings: RefundEmailStrings,
  locale = 'en',
  options?: TransactionalOptions
): RenderedEmail {
  const styles = emailStyles(options?.brand);
  const money = (cents: number) => formatPrice(cents, refund.currency, locale);
  const isFull = refund.refundedCents >= refund.totalCents;
  const items = refund.items ?? [];

  const headline = isFull ? strings.headlineFull : strings.headlinePartial;
  const summary = isFull ? strings.summaryFull : strings.summaryPartial;

  const itemRows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 0;${styles.rule}">${item.quantity} × ${escapeHtml(item.productName)}</td>
          <td style="padding:8px 0;text-align:end;white-space:nowrap;${styles.rule}">${escapeHtml(money(item.amountCents))}</td>
        </tr>`
    )
    .join('');
  const itemsHtml = items.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:15px;margin-top:16px;"><tbody>${itemRows}
      </tbody></table>`
    : '';

  const reason = refund.reason?.trim();
  const reasonHtml = reason
    ? `<p style="margin:16px 0 0;padding:12px;border-radius:6px;white-space:pre-line;border:1px solid ${styles.ruleColor};${styles.muted}">${escapeHtml(reason)}</p>`
    : '';

  const remainingHtml = isFull ? '' : `<p style="margin:16px 0 0;${styles.muted}">${escapeHtml(strings.refundedSoFar)}</p>`;

  const buttonHtml = refund.orderUrl ? emailButton(strings.viewOrders, refund.orderUrl, styles) : '';

  const bodyHtml = `<h1 style="font-size:20px;line-height:1.3;margin:0 0 8px;">${escapeHtml(headline)}</h1>
      <p style="margin:0 0 4px;${styles.muted}">${escapeHtml(refund.shopName)}</p>

      <p style="margin:0;font-size:15px;">${escapeHtml(summary)}</p>
      ${itemsHtml}
      ${remainingHtml}
      ${reasonHtml}
      ${buttonHtml}`;

  const textLines = [headline, refund.shopName, '', summary];
  if (items.length) {
    textLines.push('', ...items.map((item) => `${item.quantity} x ${item.productName}  ${money(item.amountCents)}`));
  }
  if (!isFull) textLines.push('', strings.refundedSoFar);
  if (reason) textLines.push('', reason);
  if (refund.orderUrl) textLines.push('', `${strings.viewOrders}: ${refund.orderUrl}`);

  const framed = renderTransactionalEmail({
    brand: options?.brand,
    locale,
    subject: strings.subject,
    shopName: refund.shopName,
    shopUrl: options?.shopUrl,
    body: { html: bodyHtml, text: textLines.join('\n') },
    footerNote: strings.footer,
    footerAddress: footerAddressFor(options, locale)
  });

  return { subject: strings.subject, html: framed.html, text: framed.text };
}
