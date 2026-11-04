import { describe, expect, it } from 'vitest';

import {
  directionOf,
  hreflangOf,
  isMarketLocale,
  isValidLocaleCode,
  languageOf,
  mergeMessages,
  normalizeLocaleCode,
  parseLocale
} from './locales';

describe('isValidLocaleCode', () => {
  it('accepts lowercase language and language-country codes', () => {
    expect(isValidLocaleCode('en')).toBe(true);
    expect(isValidLocaleCode('de-at')).toBe(true);
    expect(isValidLocaleCode('ast')).toBe(true);
  });

  it('rejects uppercase, underscores and junk', () => {
    expect(isValidLocaleCode('de-AT')).toBe(false);
    expect(isValidLocaleCode('de_at')).toBe(false);
    expect(isValidLocaleCode('english')).toBe(false);
    expect(isValidLocaleCode('')).toBe(false);
  });
});

describe('normalizeLocaleCode', () => {
  it('lowercases and swaps underscores', () => {
    expect(normalizeLocaleCode(' De_AT ')).toBe('de-at');
  });
});

describe('parseLocale', () => {
  it('splits a market into language and country with canonical casing', () => {
    expect(parseLocale('de-at')).toEqual({
      code: 'de-at',
      language: 'de',
      region: 'AT',
      hreflang: 'de-AT',
      dir: 'ltr'
    });
  });

  it('handles a language-only locale', () => {
    expect(parseLocale('en')).toMatchObject({ language: 'en', region: null, hreflang: 'en' });
  });

  it('knows right-to-left languages, markets included', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('ar-ae')).toBe('rtl');
    expect(directionOf('tr')).toBe('ltr');
  });
});

describe('helpers', () => {
  it('derive the fallback language, hreflang and market flag', () => {
    expect(languageOf('en-de')).toBe('en');
    expect(hreflangOf('en-de')).toBe('en-DE');
    expect(isMarketLocale('en-de')).toBe(true);
    expect(isMarketLocale('en')).toBe(false);
  });
});

describe('mergeMessages', () => {
  const base = {
    Shop: { title: 'Shop', empty: 'Nothing' },
    Cart: { title: 'Cart', discount: { label: 'Code', apply: 'Apply' } }
  };

  it('overlays only what the market file provides, deeply', () => {
    const merged = mergeMessages(base, { Cart: { discount: { label: 'Gutschein' } } });
    expect(merged.Cart.discount).toEqual({ label: 'Gutschein', apply: 'Apply' });
    expect(merged.Shop).toEqual(base.Shop);
  });

  it('returns the base untouched without overrides and does not mutate it', () => {
    expect(mergeMessages(base, null)).toBe(base);
    mergeMessages(base, { Shop: { title: 'X' } });
    expect(base.Shop.title).toBe('Shop');
  });
});
