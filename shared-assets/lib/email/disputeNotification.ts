/**
 * The chargeback alert.
 *
 * Sent to the shop owner, not the customer: a dispute is between the shop
 * and the card network, and the person who raised it already knows. Pure
 * like the other templates — the dispute and the translated wording in,
 * subject/HTML/text out, every Stripe- or customer-supplied string escaped.
 *
 * The deadline is the point of the whole email. Miss it and the dispute is
 * lost by default, so it is the one thing rendered loudly.
 */

import { escapeHtml, type RenderedEmail } from './orderConfirmation';

/** Open, won or lost — all the owner needs to tell apart. */
export type DisputeOutcome = 'opened' | 'won' | 'lost';

export interface DisputeNotification {
  /** Short order reference, the same one the admin shows. */
  reference: string;
  shopName: string;
  /**
   * Stripe's reason code, already translated by the caller when known.
   * Amounts are not here: the caller formats them into `summary` and
   * `subject`, the same way the other templates take their wording ready.
   */
  reason: string | null;
  /** When evidence is due. Null once the dispute is closed. */
  evidenceDueAt: Date | null;
  /** Absolute URL to the order in the admin, if the shop knows its address. */
  orderUrl?: string | null;
  outcome: DisputeOutcome;
}

/** Translated wording, from the Email.dispute namespace. */
export interface DisputeEmailStrings {
  subject: string;
  headline: string;
  /** "{amount} on order {reference} has been charged back." */
  summary: string;
  reasonLabel: string;
  /** "Respond by {date}." */
  deadline: string;
  /** What happens if the owner does nothing. */
  deadlineWarning: string;
  viewOrder: string;
  footer: string;
}

const RTL = new Set(['ar', 'fa', 'he', 'ur']);

/** Red for a live dispute or a loss, green once it is won. */
const ACCENT: Record<DisputeOutcome, string> = {
  opened: '#b42318',
  won: '#067647',
  lost: '#b42318'
};

export function renderDisputeNotification(
  dispute: DisputeNotification,
  strings: DisputeEmailStrings,
  locale = 'en'
): RenderedEmail {
  const dir = RTL.has(locale.split('-')[0]) ? 'rtl' : 'ltr';
  const accent = ACCENT[dispute.outcome];

  const reason = dispute.reason?.trim();
  const reasonHtml = reason
    ? `<p style="margin:12px 0 0;color:#444;">${escapeHtml(strings.reasonLabel)} ${escapeHtml(reason)}</p>`
    : '';

  // Only while there is still something to do about it.
  const deadlineHtml =
    dispute.outcome === 'opened' && dispute.evidenceDueAt
      ? `<div style="margin:16px 0 0;padding:12px;background:#fef3f2;border-left:4px solid ${accent};border-radius:4px;">
           <p style="margin:0;font-weight:600;color:${accent};">${escapeHtml(strings.deadline)}</p>
           <p style="margin:4px 0 0;color:#444;font-size:14px;">${escapeHtml(strings.deadlineWarning)}</p>
         </div>`
      : '';

  const buttonHtml = dispute.orderUrl
    ? `<p style="margin:24px 0 0;">
         <a href="${escapeHtml(dispute.orderUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">${escapeHtml(strings.viewOrder)}</a>
       </p>`
    : '';

  const html = `<!doctype html>
<html dir="${dir}" lang="${escapeHtml(locale)}">
  <body style="margin:0;padding:24px;background:#f6f6f6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;">
      <h1 style="font-size:20px;margin:0 0 8px;color:${accent};">${escapeHtml(strings.headline)}</h1>
      <p style="margin:0 0 4px;color:#444;">${escapeHtml(dispute.shopName)}</p>

      <p style="margin:0;font-size:15px;">${escapeHtml(strings.summary)}</p>
      ${reasonHtml}
      ${deadlineHtml}
      ${buttonHtml}

      <p style="margin:24px 0 0;color:#888;font-size:13px;">${escapeHtml(strings.footer)}</p>
    </div>
  </body>
</html>`;

  const textLines = [strings.headline, dispute.shopName, '', strings.summary];
  if (reason) textLines.push('', `${strings.reasonLabel} ${reason}`);
  if (dispute.outcome === 'opened' && dispute.evidenceDueAt) {
    textLines.push('', strings.deadline, strings.deadlineWarning);
  }
  if (dispute.orderUrl) textLines.push('', `${strings.viewOrder}: ${dispute.orderUrl}`);
  textLines.push('', strings.footer);

  return { subject: strings.subject, html, text: textLines.join('\n') };
}
