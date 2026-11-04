/**
 * Locale codes.
 *
 * A shop's locales are BCP 47 tags written lowercase in URLs: `en`, `de`,
 * `de-at`, `en-de`. A bare language code is a language-only locale; a
 * language-country code is a market (same language, different country:
 * other legal names, other delivery promise, in time other prices).
 *
 * Google reads hreflang case-insensitively, but validators and people
 * expect `de-AT`, so the URL form and the hreflang form are kept apart.
 */

/** `xx` or `xx-yy` (ISO 639-1 language, ISO 3166-1 alpha-2 country), lowercase. */
export const LOCALE_CODE_PATTERN = /^[a-z]{2,3}(-[a-z]{2})?$/;

export interface ParsedLocale {
  /** As used in URLs and message file names: `de-at`. */
  code: string;
  /** ISO 639-1: `de`. Messages fall back to this. */
  language: string;
  /** ISO 3166-1 alpha-2 uppercase, or null for a language-only locale. */
  region: string | null;
  /** For hreflang and html lang: `de-AT`, `de`. */
  hreflang: string;
  dir: 'ltr' | 'rtl';
}

const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);

export function isValidLocaleCode(code: string): boolean {
  return LOCALE_CODE_PATTERN.test(code);
}

/** Lowercases and trims; what the generator and the URL agree on. */
export function normalizeLocaleCode(input: string): string {
  return input.trim().toLowerCase().replace('_', '-');
}

export function parseLocale(code: string): ParsedLocale {
  const normalized = normalizeLocaleCode(code);
  const [language, region] = normalized.split('-');
  const upperRegion = region ? region.toUpperCase() : null;
  return {
    code: normalized,
    language,
    region: upperRegion,
    hreflang: upperRegion ? `${language}-${upperRegion}` : language,
    dir: RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr'
  };
}

/** The language a locale's messages fall back to: `de-at` -> `de`. */
export function languageOf(code: string): string {
  return parseLocale(code).language;
}

/** `de-AT` for html lang and hreflang. */
export function hreflangOf(code: string): string {
  return parseLocale(code).hreflang;
}

export function directionOf(code: string): 'ltr' | 'rtl' {
  return parseLocale(code).dir;
}

/** True for `de-at`, false for `de`. */
export function isMarketLocale(code: string): boolean {
  return parseLocale(code).region !== null;
}

/**
 * Deep-merges region overrides over a language's messages. Overrides may be
 * partial: a market file only carries the strings that differ.
 */
export function mergeMessages<T extends Record<string, unknown>>(
  base: T,
  overrides: Record<string, unknown> | null | undefined
): T {
  if (!overrides) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const current = out[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      out[key] = mergeMessages(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
