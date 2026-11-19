import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EMAIL_BRAND,
  brandFooterFor,
  campaignThemeFromBrand,
  emailBrandOrDefault,
  parseEmailBrand
} from './brand';

describe('parseEmailBrand', () => {
  it('fills every field from an empty document', () => {
    const result = parseEmailBrand({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.brand).toEqual(DEFAULT_EMAIL_BRAND);
      expect(result.brand.brandColor).toBe('#111111');
      expect(result.brand.footer).toEqual({});
    }
  });

  it('refuses a colour that is not #rrggbb and names the field', () => {
    const result = parseEmailBrand({ brandColor: 'red' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].path).toBe('brandColor');
  });

  it('refuses a logo that is not https', () => {
    const result = parseEmailBrand({ logoUrl: 'http://shop.test/logo.png' });
    expect(result.ok).toBe(false);
  });

  it('keeps a footer per locale and refuses an unknown locale code', () => {
    const good = parseEmailBrand({ footer: { en: 'Test Shop Ltd', 'de-at': 'Test Shop GmbH' } });
    expect(good.ok).toBe(true);
    const bad = parseEmailBrand({ footer: { 'not a locale': 'x' } });
    expect(bad.ok).toBe(false);
  });
});

describe('emailBrandOrDefault', () => {
  it('returns the defaults for nothing at all', () => {
    expect(emailBrandOrDefault(null)).toEqual(DEFAULT_EMAIL_BRAND);
    expect(emailBrandOrDefault('junk')).toEqual(DEFAULT_EMAIL_BRAND);
  });

  it('keeps the fields that parse and drops the ones that do not', () => {
    const brand = emailBrandOrDefault({ brandColor: '#aa0000', textColor: 'blue', logoWidth: 9999 });
    expect(brand.brandColor).toBe('#aa0000');
    expect(brand.textColor).toBe(DEFAULT_EMAIL_BRAND.textColor);
    expect(brand.logoWidth).toBe(DEFAULT_EMAIL_BRAND.logoWidth);
  });
});

describe('campaignThemeFromBrand', () => {
  it('is the brand without its footer', () => {
    const theme = campaignThemeFromBrand({ ...DEFAULT_EMAIL_BRAND, brandColor: '#aa0000', footer: { en: 'x' } });
    expect(theme.brandColor).toBe('#aa0000');
    expect('footer' in theme).toBe(false);
  });
});

describe('brandFooterFor', () => {
  const brand = { ...DEFAULT_EMAIL_BRAND, footer: { en: 'Test Shop Ltd, London', de: 'Test Shop GmbH, Berlin', tr: '   ' } };

  it('picks the locale, then the language, then the default', () => {
    expect(brandFooterFor(brand, 'de-at', 'en')).toBe('Test Shop GmbH, Berlin');
    expect(brandFooterFor(brand, 'ar', 'en')).toBe('Test Shop Ltd, London');
  });

  it('treats a blank entry as missing', () => {
    expect(brandFooterFor(brand, 'tr', 'en')).toBe('Test Shop Ltd, London');
    expect(brandFooterFor(DEFAULT_EMAIL_BRAND, 'en', 'en')).toBeNull();
  });
});
