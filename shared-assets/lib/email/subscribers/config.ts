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

export function newsletterStatus(env: Record<string, string | undefined> = process.env): NewsletterStatus {
  if (getEmailConfig().provider === 'none') return { enabled: false, reason: 'email-not-configured' };
  const secret = signingSecret(env);
  if (!secret) return { enabled: false, reason: 'no-signing-secret' };
  const siteUrl = env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '');
  if (!siteUrl || !/^https?:\/\//.test(siteUrl)) return { enabled: false, reason: 'no-site-url' };
  return { enabled: true, secret, siteUrl };
}
