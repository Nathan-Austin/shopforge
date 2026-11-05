/**
 * Signed links for the subscriber list: confirm a sign-up, unsubscribe.
 *
 * A token is `v1.<payload>.<signature>`, the payload naming the subscriber
 * and what the link is for, the signature an HMAC-SHA256 with the shop's
 * EMAIL_SIGNING_SECRET. Nothing guessable is stored in the database and a
 * link cannot be turned into another (a confirm link does not unsubscribe,
 * and no one can unsubscribe a person whose link they never received).
 *
 * Confirmation links expire; unsubscribe links never do, because an email
 * from two years ago must still let its reader leave.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type TokenPurpose = 'confirm' | 'unsubscribe';

/** How long a confirmation link works. */
export const CONFIRM_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Shorter secrets are refused: they would make the links guessable. */
export const MIN_SECRET_LENGTH = 32;

interface Payload {
  /** Subscriber id. */
  s: string;
  p: TokenPurpose;
  /** Issued at, in seconds; confirm links only. */
  t?: number;
}

/** EMAIL_SIGNING_SECRET, or NEXTAUTH_SECRET for shops generated before it; null if neither is usable. */
export function signingSecret(env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.EMAIL_SIGNING_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim() || '';
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(`shopforge-subscriber:${body}`).digest('base64url');
}

export function signSubscriberToken(subscriberId: string, purpose: TokenPurpose, secret: string, now: Date = new Date()): string {
  const payload: Payload = { s: subscriberId, p: purpose, ...(purpose === 'confirm' ? { t: Math.floor(now.getTime() / 1000) } : {}) };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `v1.${body}.${sign(body, secret)}`;
}

export type TokenCheck =
  | { ok: true; subscriberId: string }
  | { ok: false; reason: 'malformed' | 'signature' | 'purpose' | 'expired' };

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function verifySubscriberToken(token: unknown, purpose: TokenPurpose, secret: string, now: Date = new Date()): TokenCheck {
  if (typeof token !== 'string' || token.length > 500) return { ok: false, reason: 'malformed' };
  const [version, body, signature, extra] = token.split('.');
  if (version !== 'v1' || !body || !signature || extra !== undefined) return { ok: false, reason: 'malformed' };

  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  // Compared in constant time, so the signature cannot be guessed byte by byte.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'signature' };

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload?.s !== 'string' || !ID_PATTERN.test(payload.s)) return { ok: false, reason: 'malformed' };
  if (payload.p !== purpose) return { ok: false, reason: 'purpose' };
  if (purpose === 'confirm') {
    const issued = Number(payload.t);
    const age = now.getTime() / 1000 - issued;
    if (!Number.isFinite(issued) || age > CONFIRM_TTL_SECONDS || age < -300) return { ok: false, reason: 'expired' };
  }
  return { ok: true, subscriberId: payload.s };
}
