/**
 * Whether the newsletter can run in this shop. Sign-up needs three things:
 * email configured (the confirmation has to go out), a signing secret for
 * the links, and the shop's own address to put in them. Without any one
 * of them the sign-up form is not shown at all, rather than taking an
 * address and failing quietly.
 */

import { getEmailConfig } from '../config';
import { signingSecret } from './tokens';

export type NewsletterStatus =
  | { enabled: true; secret: string; siteUrl: string }
  | { enabled: false; reason: 'email-not-configured' | 'no-signing-secret' | 'no-site-url' };

export function newsletterStatus(
  env: Record<string, string | undefined> = process.env,
  /**
   * Whether the shop can send at all. Defaults to the environment's view, so
   * this stays synchronous for callers that have no key in Vault to consider;
   * resolveNewsletterStatus() below passes the full answer.
   */
  emailConfigured: boolean = getEmailConfig().provider !== 'none'
): NewsletterStatus {
  if (!emailConfigured) return { enabled: false, reason: 'email-not-configured' };
  const secret = signingSecret(env);
  if (!secret) return { enabled: false, reason: 'no-signing-secret' };
  const siteUrl = env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '');
  if (!siteUrl || !/^https?:\/\//.test(siteUrl)) return { enabled: false, reason: 'no-site-url' };
  return { enabled: true, secret, siteUrl };
}

/**
 * The same answer, but also seeing a provider key typed into the admin and
 * kept in Vault. Anything running on the server (pages, actions, the
 * subscriber service) should use this; without it a shop whose key is in
 * Vault would hide its own sign-up form.
 */
export async function resolveNewsletterStatus(
  env: Record<string, string | undefined> = process.env
): Promise<NewsletterStatus> {
  const { resolveEmailConfig } = await import('../config');
  return newsletterStatus(env, (await resolveEmailConfig()).provider !== 'none');
}
