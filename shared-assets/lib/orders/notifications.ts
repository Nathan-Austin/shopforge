/**
 * Which status changes email the customer, and tracking-link helpers.
 *
 * Pure functions. The admin's status action asks notificationForStatusChange
 * after every save; the answer is the single place that decides whether a
 * customer hears about a change, so the anti-spam rules live here and are
 * unit-tested rather than scattered through the action.
 */

export type OrderNotificationKind = 'shipped';

export interface StatusChange {
  /** Status before the save. */
  from: string;
  /** Status after the save. */
  to: string;
  /** When the customer was last told the order shipped, if ever. */
  shippingNotifiedAt: string | null | undefined;
}

/**
 * The email to send for a status change, or null for none.
 *
 * Only arriving at 'fulfilled' (shipped) emails, and only once per order:
 * a second arrival (owner flips to paid and back) is silent, as is saving
 * the same status again. A first attempt that failed to send leaves
 * shippingNotifiedAt empty, so the next arrival retries. Cancellations are
 * deliberately quiet here: a paid order that is cancelled is refunded, and
 * the refund email covers it.
 */
export function notificationForStatusChange(change: StatusChange): OrderNotificationKind | null {
  if (change.to !== 'fulfilled') return null;
  if (change.from === 'fulfilled') return null;
  if (change.shippingNotifiedAt) return null;
  return 'shipped';
}

export interface Tracking {
  carrier: string | null;
  number: string | null;
  url: string | null;
}

/**
 * Carriers whose public tracking page takes the number in the URL. Owners
 * can always paste an explicit link instead; this only saves them the trip
 * for the common ones. Keys are matched case-insensitively on the carrier
 * name the owner typed.
 */
export const CARRIER_TRACKING_URLS: Record<string, (number: string) => string> = {
  dhl: (n) => `https://www.dhl.com/en/express/tracking.html?AWB=${n}`,
  'dhl paket': (n) => `https://www.dhl.de/en/privatkunden/pakete-empfangen/verfolgen.html?piececode=${n}`,
  'deutsche post': (n) => `https://www.deutschepost.de/en/s/sendungsverfolgung.html?piececode=${n}`,
  dpd: (n) => `https://tracking.dpd.de/status/en_US/parcel/${n}`,
  hermes: (n) => `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#${n}`,
  gls: (n) => `https://gls-group.eu/track/${n}`,
  ups: (n) => `https://www.ups.com/track?tracknum=${n}`,
  fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
  usps: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
  'royal mail': (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${n}`,
  'an post': (n) => `https://www.anpost.com/Post-Parcels/Track/History?item=${n}`,
  'la poste': (n) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`,
  postnl: (n) => `https://postnl.nl/tracktrace/?B=${n}`,
  'ptt kargo': (n) => `https://gonderitakip.ptt.gov.tr/Track/Verify?q=${n}`,
  aramex: (n) => `https://www.aramex.com/track/results?ShipmentNumber=${n}`
};

/** A tracking link for a known carrier and number, or null. */
export function trackingUrlFor(
  carrier: string | null | undefined,
  number: string | null | undefined
): string | null {
  const key = carrier?.trim().toLowerCase();
  const id = number?.trim();
  if (!key || !id) return null;
  const build = CARRIER_TRACKING_URLS[key];
  return build ? build(encodeURIComponent(id)) : null;
}

/** Only http(s) links are ever rendered, in email or on a page. */
export function safeTrackingUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : null;
}

/**
 * Cleans what the owner typed. An explicit link wins; otherwise one is
 * derived from a known carrier. Blank fields become null.
 */
export function normalizeTracking(input: {
  carrier?: string | null;
  number?: string | null;
  url?: string | null;
}): Tracking {
  const carrier = input.carrier?.trim() || null;
  const number = input.number?.trim() || null;
  const url = safeTrackingUrl(input.url) ?? trackingUrlFor(carrier, number);
  return { carrier, number, url };
}

/** True when there is anything worth showing the customer. */
export function hasTracking(tracking: Tracking): boolean {
  return Boolean(tracking.carrier || tracking.number || tracking.url);
}
