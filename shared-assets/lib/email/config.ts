/**
 * Transactional email configuration, read from the environment.
 *
 * Email is optional: with no provider key the shop works exactly as before
 * and sends nothing, so a fresh store runs without a Resend account. Set
 * RESEND_API_KEY and EMAIL_FROM to turn it on.
 */
export interface EmailConfig {
  /** 'resend' when a key is configured, otherwise 'none'. */
  provider: 'resend' | 'none';
  apiKey: string | null;
  /** Verified sender, e.g. "My Shop <orders@myshop.com>". */
  from: string | null;
  /** Where customer replies should go, if not the sender. */
  replyTo: string | null;
  /** Optional copy of every order confirmation for the shop owner. */
  ownerNotificationEmail: string | null;
}

export function getEmailConfig(): EmailConfig {
  const apiKey = process.env.RESEND_API_KEY?.trim() || null;
  const from = process.env.EMAIL_FROM?.trim() || null;

  return {
    // Both are needed: a key with no verified sender cannot send anything.
    provider: apiKey && from ? 'resend' : 'none',
    apiKey,
    from,
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || null,
    ownerNotificationEmail: process.env.SHOP_OWNER_EMAIL?.trim() || null
  };
}
