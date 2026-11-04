/**
 * Store-level facts the SEO markup needs: the shop's name, where it ships,
 * what shipping costs. Read from the environment and the shop's config so
 * the product page, the home page and the feed say the same thing.
 */

import { CHECKOUT_CONFIG } from '@/lib/checkout/config';
import { SHIPPING_CONFIG } from '@/lib/shipping/config';
import { siteUrl } from './alternates';
import type { ProductJsonLdInput } from './jsonld';

export function shopName(): string {
  return process.env.NEXT_PUBLIC_SHOP_NAME?.trim() || 'Our shop';
}

/** The Search Console HTML-tag verification code, if the owner set one. */
export function googleSiteVerification(): string | null {
  return process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim() || null;
}

/** Absolute logo URL when the shop has one at /logo.png, else null. */
export function logoUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_SHOP_LOGO_URL?.trim();
  if (configured) return configured.startsWith('http') ? configured : `${siteUrl()}${configured}`;
  return null;
}

/**
 * The shop-wide shipping policy for structured data: the flat rate to the
 * countries the checkout accepts. Pass the order's currency when the
 * shipping config's one does not apply.
 */
export function shippingPolicy(currency = SHIPPING_CONFIG.currency): ProductJsonLdInput['shipping'] {
  return {
    rateCents: SHIPPING_CONFIG.flatRateCents,
    currency,
    countries: [...CHECKOUT_CONFIG.allowedCountries]
  };
}

/**
 * Return policy for structured data. Not configured by default: Google
 * prefers the policy set in Merchant Center, and a wrong policy in markup
 * is worse than none. Set NEXT_PUBLIC_RETURN_DAYS (and optionally
 * NEXT_PUBLIC_RETURN_FEES=free|customer) to emit one.
 */
export function returnPolicy(country: string): ProductJsonLdInput['returnPolicy'] {
  const days = Number(process.env.NEXT_PUBLIC_RETURN_DAYS ?? '');
  if (!Number.isInteger(days) || days <= 0) return null;
  const fees = process.env.NEXT_PUBLIC_RETURN_FEES === 'customer' ? 'customer' : 'free';
  return { country, days, fees };
}
