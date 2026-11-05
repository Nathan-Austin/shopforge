/**
 * Where subscriber links point. The confirm and unsubscribe pages ask for
 * a click before they change anything: mail scanners open every link in
 * an email, and a scanner must not be able to subscribe or unsubscribe
 * anyone. The one-click address is the exception, by design: mail clients
 * POST to it from their own "Unsubscribe" button (RFC 8058).
 */

function base(siteUrl: string): string {
  return siteUrl.replace(/\/$/, '');
}

export function confirmUrl(siteUrl: string, locale: string, token: string): string {
  return `${base(siteUrl)}/${locale}/newsletter/confirm?t=${encodeURIComponent(token)}`;
}

export function unsubscribeUrl(siteUrl: string, locale: string, token: string): string {
  return `${base(siteUrl)}/${locale}/newsletter/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** What previews and test sends link to: the page, saying it is a preview. */
export function unsubscribePreviewUrl(siteUrl: string, locale: string): string {
  return `${base(siteUrl)}/${locale}/newsletter/unsubscribe?preview=1`;
}

export function oneClickUnsubscribeUrl(siteUrl: string, locale: string, token: string): string {
  return `${base(siteUrl)}/api/email/unsubscribe?t=${encodeURIComponent(token)}&l=${encodeURIComponent(locale)}`;
}

/**
 * The headers Gmail and Yahoo require on bulk mail: an address to POST to
 * and the marker that a POST alone unsubscribes. Campaign sending (roadmap
 * phase E) puts them on every message.
 */
export function listUnsubscribeHeaders(siteUrl: string, locale: string, token: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${oneClickUnsubscribeUrl(siteUrl, locale, token)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  };
}
