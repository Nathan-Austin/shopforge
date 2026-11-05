/**
 * Per-locale campaign text.
 *
 * Layout, images and links are shared by every language; only wording is
 * stored per locale, as `{ en: '...', de: '...' }`. A recipient gets their
 * locale, then its language (`de-at` -> `de`), then the campaign's default
 * locale: the same fallback the shop's message files use, so a market only
 * needs to translate what differs.
 */

import { languageOf, normalizeLocaleCode } from '../../i18n/locales';

export type Localized<T> = Partial<Record<string, T>>;

/** `de-at` with default `en` -> `['de-at', 'de', 'en']`. */
export function localeFallbackChain(locale: string, defaultLocale: string): string[] {
  const wanted = normalizeLocaleCode(locale);
  const fallback = normalizeLocaleCode(defaultLocale);
  return Array.from(new Set([wanted, languageOf(wanted), fallback, languageOf(fallback)]));
}

export interface Picked<T> {
  value: T;
  /** The locale the value came from. */
  locale: string;
  /**
   * True when the text is in another language than the one asked for, so
   * the designer can flag a missing translation. `de` for `de-at` is the
   * normal fallback and does not count.
   */
  fellBack: boolean;
}

/**
 * The best value for a locale, skipping empty entries (an untranslated
 * field the editor saved as `''`). Null when no locale in the chain has one.
 */
export function pickLocalized<T>(
  value: Localized<T> | undefined,
  locale: string,
  defaultLocale: string,
  isEmpty: (entry: T) => boolean
): Picked<T> | null {
  if (!value) return null;
  const wantedLanguage = languageOf(locale);
  for (const candidate of localeFallbackChain(locale, defaultLocale)) {
    const entry = value[candidate];
    if (entry !== undefined && entry !== null && !isEmpty(entry)) {
      return { value: entry, locale: candidate, fellBack: languageOf(candidate) !== wantedLanguage };
    }
  }
  return null;
}

export const isBlankString = (entry: string) => entry.trim() === '';
