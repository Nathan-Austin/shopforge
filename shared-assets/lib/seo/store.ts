/**
 * Store-level facts the SEO markup needs: the shop's name, where it ships,
 * what shipping costs. Read from the environment and the shop's config so
 * the product page, the home page and the feed say the same thing.
 */

import { getCheckoutSettings, getShippingSettings, getShopCurrency, getShopName, getStoreSetting } from '@/lib/settings/store';
import { siteUrl } from './alternates';
import type { ProductJsonLdInput } from './jsonld';

/** The shop's name: the saved setting, or the generated one until then. */
export async function shopName(): Promise<string> {
  return getShopName();
}

/** The Search Console HTML-tag verification code, if the owner set one. */
export function googleSiteVerification(): string | null {
  return process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim() || null;
}

/**
 * Absolute logo URL, or null when the shop has none. The shop setting (Q5),
 * falling back to NEXT_PUBLIC_SHOP_LOGO_URL; a site-relative path is made
 * absolute, as structured data requires.
 */
export async function logoUrl(): Promise<string | null> {
  const { logoUrl: configured } = await getStoreSetting('shop');
  if (configured) return configured.startsWith('http') ? configured : `${siteUrl()}${configured}`;
  return null;
}

/**
 * The shop-wide shipping policy for structured data: the flat rate to the
 * countries the checkout accepts, in the shop's currency unless the
 * caller passes the order's own.
 */
export async function shippingPolicy(currency?: string): Promise<ProductJsonLdInput['shipping']> {
  const [{ allowedCountries }, shipping, shopCurrency] = await Promise.all([
    getCheckoutSettings(),
    getShippingSettings(),
    getShopCurrency()
  ]);
  return {
    rateCents: shipping.flatRateCents,
    currency: currency ?? shopCurrency,
    countries: [...allowedCountries]
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

/**
 * The same policy for the shop as a whole. Structured data takes one
 * country: the shop's home country from the shipping settings, or, until
 * one is saved, the first of the countries it delivers to (stored in
 * alphabetical order), as before.
 */
export async function shopReturnPolicy(): Promise<ProductJsonLdInput['returnPolicy']> {
  const [{ allowedCountries }, { homeCountry }] = await Promise.all([getCheckoutSettings(), getShippingSettings()]);
  return returnPolicy(homeCountry ?? allowedCountries[0]);
}
