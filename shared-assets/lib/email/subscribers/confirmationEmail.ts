/**
 * The double opt-in email: one button to confirm, and a plain promise that
 * nothing more arrives if the reader did not sign up. Pure, with the
 * wording translated by the caller (`Email.subscribe`), like the order
 * emails.
 */

import { directionOf, hreflangOf } from '../../i18n/locales';
import { escapeHtml, type RenderedEmail } from '../orderConfirmation';

export interface SubscribeEmailStrings {
  subject: string;
  headline: string;
  intro: string;
  button: string;
  expires: string;
  ignore: string;
}

export function renderSubscriptionConfirmation(
  confirmUrl: string,
  shopName: string,
  strings: SubscribeEmailStrings,
  locale = 'en'
): RenderedEmail {
  if (!/^https?:\/\//i.test(confirmUrl)) throw new Error('The confirmation link must be absolute');
  const dir = directionOf(locale);
  const html = `<!doctype html>
<html lang="${escapeHtml(hreflangOf(locale))}" dir="${dir}">
  <body style="margin:0;padding:24px;background:#f6f6f6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;">
      <p style="margin:0 0 4px;color:#444;">${escapeHtml(shopName)}</p>
      <h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(strings.headline)}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">${escapeHtml(strings.intro)}</p>
      <p style="margin:0 0 20px;">
        <a href="${escapeHtml(confirmUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">${escapeHtml(strings.button)}</a>
      </p>
      <p style="margin:0 0 8px;color:#666;font-size:13px;">${escapeHtml(strings.expires)}</p>
      <p style="margin:0;color:#666;font-size:13px;">${escapeHtml(strings.ignore)}</p>
    </div>
  </body>
</html>`;
  const text = [shopName, '', strings.headline, '', strings.intro, '', `${strings.button}: ${confirmUrl}`, '', strings.expires, strings.ignore].join('\n');
  return { subject: strings.subject, html, text };
}
