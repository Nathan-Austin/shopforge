/**
 * The shop's email brand: the logo, colours, font and footer address that
 * every transactional email (receipt, shipping, refund) is dressed in, and
 * that a new campaign template starts from.
 *
 * It is the campaign builder's theme plus a footer per locale, kept as one
 * JSON document under the `email_brand` key of store_settings. Pure: the
 * database reading lives in ./brandStore so this file can be unit tested
 * and used by the renderers without a Supabase client.
 */

import { z } from 'zod';

import { isBlankString, pickLocalized, type Localized } from './campaigns/localize';
import { localized, themeSchema, type CampaignTheme } from './campaigns/schema';

/** The store_settings key the brand is stored under. */
export const EMAIL_BRAND_KEY = 'email_brand';

/** A footer entry per locale: the postal address, a legal line, or nothing. */
export const EMAIL_BRAND_FOOTER_MAX = 600;

export const emailBrandSchema = themeSchema.extend({
  /** Shown under every transactional email; empty is allowed. */
  footer: localized(z.string().max(EMAIL_BRAND_FOOTER_MAX)).default({})
});

export type EmailBrand = z.infer<typeof emailBrandSchema>;
export type EmailBrandInput = z.input<typeof emailBrandSchema>;

/** What a shop that has never opened the brand settings sends with. */
export const DEFAULT_EMAIL_BRAND: EmailBrand = emailBrandSchema.parse({});

export type EmailBrandIssue = { path: string; message: string };

export type EmailBrandParseResult =
  | { ok: true; brand: EmailBrand }
  | { ok: false; issues: EmailBrandIssue[] };

/** Strict: the admin's save path. Every field has to be right. */
export function parseEmailBrand(input: unknown): EmailBrandParseResult {
  const parsed = emailBrandSchema.safeParse(input);
  if (parsed.success) return { ok: true, brand: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }))
  };
}

/**
 * Lenient: the sending path. A stored document that no longer parses (an
 * older shape, a hand edit) must never stop a receipt going out, so each
 * field falls back to its default on its own and the email still sends.
 */
export function emailBrandOrDefault(input: unknown): EmailBrand {
  const strict = emailBrandSchema.safeParse(input);
  if (strict.success) return strict.data;
  if (!input || typeof input !== 'object') return DEFAULT_EMAIL_BRAND;

  const record = input as Record<string, unknown>;
  const repaired: Record<string, unknown> = {};
  for (const key of Object.keys(emailBrandSchema.shape) as (keyof EmailBrand)[]) {
    const field = emailBrandSchema.shape[key];
    if (key in record && field.safeParse(record[key]).success) repaired[key] = record[key];
  }
  const second = emailBrandSchema.safeParse(repaired);
  return second.success ? second.data : DEFAULT_EMAIL_BRAND;
}

/** The brand as a campaign document's theme: the same fields minus the footer. */
export function campaignThemeFromBrand(brand: EmailBrand): CampaignTheme {
  return {
    brandColor: brand.brandColor,
    textColor: brand.textColor,
    backgroundColor: brand.backgroundColor,
    contentColor: brand.contentColor,
    fontFamily: brand.fontFamily,
    logoUrl: brand.logoUrl,
    logoWidth: brand.logoWidth
  };
}

/** The footer text for a recipient's locale, with the shop's fallback chain. */
export function brandFooterFor(brand: EmailBrand, locale: string, defaultLocale: string): string | null {
  const footer: Localized<string> = brand.footer;
  return pickLocalized(footer, locale, defaultLocale, isBlankString)?.value.trim() ?? null;
}
