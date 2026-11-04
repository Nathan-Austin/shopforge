import 'server-only';

import { getEmailConfig } from './config';

/**
 * Sending transactional email.
 *
 * Resend's REST API is called with fetch rather than their SDK: it is one
 * POST, and it keeps the generated store's dependency list shorter. Swap
 * the body here to move to another provider; everything else talks to
 * sendEmail().
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Visible copy, used to keep the shop owner in the loop on a refund. */
  cc?: string | null;
  /** Blind copy, used for the shop owner's copy of an order. */
  bcc?: string | null;
}

export type SendResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: 'not-configured' | 'failed'; error?: string };

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const config = getEmailConfig();

  if (config.provider === 'none' || !config.apiKey || !config.from) {
    // Not an error: a shop without email configured simply doesn't send.
    return { sent: false, reason: 'not-configured' };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
        ...(message.cc ? { cc: [message.cc] } : {}),
        ...(message.bcc ? { bcc: [message.bcc] } : {})
      })
    });

    if (!response.ok) {
      // Read the body for the reason, but never log the API key.
      const detail = await response.text().catch(() => '');
      return {
        sent: false,
        reason: 'failed',
        error: `Resend responded ${response.status}: ${detail.slice(0, 300)}`
      };
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { sent: true, id: body?.id ?? null };
  } catch (error) {
    return {
      sent: false,
      reason: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
