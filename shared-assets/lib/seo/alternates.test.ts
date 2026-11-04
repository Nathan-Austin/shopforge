import { describe, expect, it } from 'vitest';

import { alternatesOn, localizedUrlOn, sitemapEntriesOn } from './alternates';

const base = 'https://shop.example';
const locales = ['en', 'de', 'de-at', 'ar'];

describe('localizedUrlOn', () => {
  it('builds absolute, prefixed URLs whatever the slashes', () => {
    expect(localizedUrlOn(base, 'de-at', '/shop/sauce')).toBe('https://shop.example/de-at/shop/sauce');
    expect(localizedUrlOn(`${base}/`, 'en', 'shop')).toBe('https://shop.example/en/shop');
    expect(localizedUrlOn(base, 'en', '')).toBe('https://shop.example/en');
    expect(localizedUrlOn(base, 'en', '/')).toBe('https://shop.example/en');
  });
});

describe('alternatesOn', () => {
  const set = alternatesOn(base, locales, 'en', 'de-at', '/shop/sauce');

  it('uses the page\'s own locale URL as canonical, never the default locale', () => {
    expect(set.canonical).toBe('https://shop.example/de-at/shop/sauce');
  });

  it('lists every locale with canonical hreflang casing, itself included', () => {
    expect(set.languages).toEqual({
      en: 'https://shop.example/en/shop/sauce',
      de: 'https://shop.example/de/shop/sauce',
      'de-AT': 'https://shop.example/de-at/shop/sauce',
      ar: 'https://shop.example/ar/shop/sauce',
      'x-default': 'https://shop.example/en/shop/sauce'
    });
    expect(Object.values(set.languages)).toContain(set.canonical);
  });

  it('is reciprocal: every locale version lists the same set', () => {
    for (const locale of locales) {
      const other = alternatesOn(base, locales, 'en', locale, '/shop/sauce');
      expect(other.languages).toEqual(set.languages);
      expect(other.languages[locale === 'de-at' ? 'de-AT' : locale]).toBe(other.canonical);
    }
  });

  it('points x-default at the default locale, whatever page it is on', () => {
    expect(alternatesOn(base, locales, 'de', 'ar', '').languages['x-default']).toBe(
      'https://shop.example/de'
    );
  });

  it('has exactly one x-default and only absolute URLs', () => {
    const keys = Object.keys(set.languages).filter((key) => key === 'x-default');
    expect(keys).toHaveLength(1);
    for (const url of Object.values(set.languages)) expect(url).toMatch(/^https:\/\//);
  });
});

describe('sitemapEntriesOn', () => {
  it('emits one entry per locale, each with the full alternate set', () => {
    const entries = sitemapEntriesOn(base, locales, 'en', '/shop', { priority: 0.8 });
    expect(entries.map((entry) => entry.url)).toEqual([
      'https://shop.example/en/shop',
      'https://shop.example/de/shop',
      'https://shop.example/de-at/shop',
      'https://shop.example/ar/shop'
    ]);
    for (const entry of entries) {
      expect(entry.alternates?.languages).toEqual(
        alternatesOn(base, locales, 'en', 'en', '/shop').languages
      );
      expect(entry.priority).toBe(0.8);
    }
  });
});
