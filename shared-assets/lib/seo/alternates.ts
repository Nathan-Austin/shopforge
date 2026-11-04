/**
 * Canonical and hreflang links.
 *
 * One helper builds the set for a page, and the sitemap uses the same one,
 * so the two can never disagree. Every indexable page lists every locale
 * version of itself (so the set is reciprocal and self-referencing by
 * construction), plus x-default pointing at the default locale, and a
 * canonical that is its own URL, never another locale's.
 */

import type { Metadata, MetadataRoute } from 'next';

import { DEFAULT_LOCALE, LOCALES } from '@/i18n/config';
import { hreflangOf } from '@/lib/i18n/locales';

/** The shop's public origin, no trailing slash. */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

/** `/shop/foo` -> `/shop/foo`; `shop/foo` -> `/shop/foo`; `` -> ``. */
function normalizePath(path: string): string {
  if (!path || path === '/') return '';
  return path.startsWith('/') ? path : `/${path}`;
}

/** Absolute URL of a path in a locale: https://shop/de-at/shop/foo */
export function localizedUrlOn(base: string, locale: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${locale}${normalizePath(path)}`;
}

export function localizedUrl(locale: string, path: string): string {
  return localizedUrlOn(siteUrl(), locale, path);
}

export interface AlternateSet {
  canonical: string;
  /** hreflang value -> absolute URL, x-default included. */
  languages: Record<string, string>;
}

/**
 * The full set for one page. `locales` are URL codes (`de-at`); the keys
 * of `languages` are hreflang values (`de-AT`).
 */
export function alternatesOn(
  base: string,
  locales: readonly string[],
  defaultLocale: string,
  locale: string,
  path: string
): AlternateSet {
  const languages: Record<string, string> = {};
  for (const code of locales) {
    languages[hreflangOf(code)] = localizedUrlOn(base, code, path);
  }
  languages['x-default'] = localizedUrlOn(base, defaultLocale, path);
  return { canonical: localizedUrlOn(base, locale, path), languages };
}

export function alternatesFor(locale: string, path: string): AlternateSet {
  return alternatesOn(siteUrl(), LOCALES, DEFAULT_LOCALE, locale, path);
}

/** For a page's generateMetadata: canonical + hreflang links in <head>. */
export function pageAlternates(locale: string, path: string): NonNullable<Metadata['alternates']> {
  const set = alternatesFor(locale, path);
  return { canonical: set.canonical, languages: set.languages };
}

/**
 * For pages that must not be indexed (cart, checkout, account, auth,
 * admin): no canonical, no hreflang, and robots says so.
 */
export const NOINDEX: Pick<Metadata, 'robots'> = {
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } }
};

/** One sitemap entry per locale for a path, each carrying the whole set. */
export function sitemapEntriesOn(
  base: string,
  locales: readonly string[],
  defaultLocale: string,
  path: string,
  options: { lastModified?: Date | string; priority?: number } = {}
): MetadataRoute.Sitemap {
  return locales.map((code) => {
    const set = alternatesOn(base, locales, defaultLocale, code, path);
    return {
      url: set.canonical,
      lastModified: options.lastModified,
      priority: options.priority,
      alternates: { languages: set.languages }
    };
  });
}

export function sitemapEntriesFor(
  path: string,
  options: { lastModified?: Date | string; priority?: number } = {}
): MetadataRoute.Sitemap {
  return sitemapEntriesOn(siteUrl(), LOCALES, DEFAULT_LOCALE, path, options);
}
