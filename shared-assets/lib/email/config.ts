/**
 * Email configuration.
 *
 * Email is optional: with no provider key the shop works exactly as before
 * and sends nothing, so a fresh store runs without a Resend account. Set
 * RESEND_API_KEY and EMAIL_FROM to turn it on, or set EMAIL_FROM and type the
 * key into /admin/email/settings, which keeps it in Supabase Vault.
 *
 * Two readers, because the key can live in two places:
 *
 *   * getEmailConfig() is synchronous and sees the environment only. Use it
 *     for the sender, the reply-to and the owner's address, which are always
 *     environment settings.
 *   * resolveEmailConfig() is async and also looks in Vault. Anything that
 *     needs the key, or needs to say whether the shop can send at all, must
 *     use this one — otherwise a shop whose key was typed into the admin
 *     looks unconfigured.
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

function configWithKey(apiKey: string | null): EmailConfig {
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

/** The environment's view. Sees a key in RESEND_API_KEY, never one in Vault. */
export function getEmailConfig(): EmailConfig {
  return configWithKey(process.env.RESEND_API_KEY?.trim() || null);
}

/**
 * The whole view: the environment first, then a key stored from the admin.
 *
 * providerKey is imported here rather than at the top so that this module
 * stays free of `server-only` and the Supabase client. getEmailConfig() is
 * read in plain unit tests and by code that only wants the sender address,
 * and neither should have to drag a service-role client along.
 */
export async function resolveEmailConfig(): Promise<EmailConfig> {
  const { loadEmailProviderKey } = await import('./providerKey');
  return configWithKey(await loadEmailProviderKey());
}
