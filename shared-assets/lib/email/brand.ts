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
import { describeWordingTagProblem, wordingTagProblems } from './wordingTags';

/** The store_settings key the brand is stored under. */
export const EMAIL_BRAND_KEY = 'email_brand';

/** A footer entry per locale: the postal address, a legal line, or nothing. */
export const EMAIL_BRAND_FOOTER_MAX = 600;

/** The customer emails whose wording the owner can edit. */
export const TRANSACTIONAL_KINDS = ['confirmation', 'shipping', 'refund'] as const;
export type TransactionalKind = (typeof TRANSACTIONAL_KINDS)[number];

/** An intro or a footer line: a short paragraph, per locale. */
export const EMAIL_COPY_MAX = 1000;

/** Owner wording: plain text that may use the tags in ./wordingTags. */
const wordingSchema = z
  .string()
  .max(EMAIL_COPY_MAX)
  .superRefine((value, ctx) => {
    for (const problem of wordingTagProblems(value)) {
      ctx.addIssue({ code: 'custom', message: describeWordingTagProblem(problem) });
    }
  });

const copyEntrySchema = z.object({
  /** Replaces the first paragraph; empty means the shop's built-in wording. */
  intro: localized(wordingSchema).default({}),
  /** Replaces the last line; empty means the shop's built-in wording. */
  footer: localized(wordingSchema).default({})
});

export const emailBrandSchema = themeSchema.extend({
  /** Shown under every transactional email; empty is allowed. */
  footer: localized(z.string().max(EMAIL_BRAND_FOOTER_MAX)).default({}),
  /** Editable intro and footer wording per email, per locale (G2). */
  copy: z
    .object({
      confirmation: copyEntrySchema.prefault({}),
      shipping: copyEntrySchema.prefault({}),
      refund: copyEntrySchema.prefault({})
    })
    .prefault({})
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

function pickText(value: Localized<string>, locale: string, defaultLocale: string): string | null {
  return pickLocalized(value, locale, defaultLocale, isBlankString)?.value.trim() ?? null;
}

/** The footer text for a recipient's locale, with the shop's fallback chain. */
export function brandFooterFor(brand: EmailBrand, locale: string, defaultLocale: string): string | null {
  return pickText(brand.footer, locale, defaultLocale);
}

export interface TransactionalCopy {
  intro: string | null;
  footer: string | null;
}

/** The owner's wording for one email and locale; null where the built-in text stays. */
export function transactionalCopyFor(brand: EmailBrand, kind: TransactionalKind, locale: string, defaultLocale: string): TransactionalCopy {
  const entry = brand.copy[kind];
  return {
    intro: pickText(entry.intro, locale, defaultLocale),
    footer: pickText(entry.footer, locale, defaultLocale)
  };
}
