import crypto from "crypto";

// Lets the packing-slip PDF link in the order-notification email work without
// an authenticated admin session — Outlook (and other mail clients) often open
// links in a browser/profile the owner isn't logged into, and the whole point
// of the link is that whoever is covering fulfillment can
// open it too. Scoped to a single order and time-limited, unlike the in-admin
// "Download Packing Slip" button on the order page, which still requires a
// full shop_owner + MFA session (see ensureShopOwner in admin/lib/auth.ts).
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Signing secret for HMAC links. There is deliberately no fallback: a default
// secret would let anyone forge links. Rejects unset, the generator's
// "changeme" placeholder, and anything shorter than 32 characters.
function getSigningSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret === "changeme" || secret.length < 32) {
    throw new Error("NEXTAUTH_SECRET must be set to a random value of at least 32 characters");
  }
  return secret;
}

function sign(orderId: string, expiresAt: number): string {
  return crypto.createHmac("sha256", getSigningSecret()).update(`${orderId}:${expiresAt}`).digest("hex");
}

export function buildPackingSlipUrl(siteUrl: string, orderId: string): string {
  const expiresAt = Date.now() + TTL_MS;
  const token = sign(orderId, expiresAt);
  return `${siteUrl}/api/admin/orders/${orderId}/packing-slip?token=${token}&exp=${expiresAt}`;
}

export function verifyPackingSlipToken(orderId: string, token: string | null, exp: string | null): boolean {
  if (!token || !exp) return false;
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(sign(orderId, expiresAt));
  } catch {
    return false; // misconfigured secret: fail closed
  }
  const actual = Buffer.from(token);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}
