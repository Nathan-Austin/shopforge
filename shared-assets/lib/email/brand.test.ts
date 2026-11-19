import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EMAIL_BRAND,
  brandFooterFor,
  campaignThemeFromBrand,
  emailBrandOrDefault,
  parseEmailBrand,
  transactionalCopyFor
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
  const brand = { ...DEFAULT_EMAIL_BRAND, footer: { en: 'Test Shop Ltd, London', de: 'Test Shop GmbH, Berlin', fr: '   ' } };

  it('picks the locale, then the language, then the default', () => {
    expect(brandFooterFor(brand, 'de-at', 'en')).toBe('Test Shop GmbH, Berlin');
    expect(brandFooterFor(brand, 'nl', 'en')).toBe('Test Shop Ltd, London');
  });

  it('treats a blank entry as missing', () => {
    expect(brandFooterFor(brand, 'fr', 'en')).toBe('Test Shop Ltd, London');
    expect(brandFooterFor(DEFAULT_EMAIL_BRAND, 'en', 'en')).toBeNull();
  });
});

describe('transactionalCopyFor', () => {
  const brand = parseEmailBrand({
    copy: {
      shipping: { intro: { en: 'Your parcel is off!', de: 'Dein Paket ist unterwegs!' }, footer: { en: 'Reply to this email with questions.' } },
      refund: { intro: {}, footer: { en: '   ' } }
    }
  });

  it('defaults every email to no custom wording', () => {
    const copy = transactionalCopyFor(DEFAULT_EMAIL_BRAND, 'confirmation', 'en', 'en');
    expect(copy).toEqual({ intro: null, footer: null });
  });

  it('picks the locale with the usual fallback, per email', () => {
    expect(brand.ok).toBe(true);
    if (!brand.ok) return;
    expect(transactionalCopyFor(brand.brand, 'shipping', 'de-at', 'en')).toEqual({
      intro: 'Dein Paket ist unterwegs!',
      footer: 'Reply to this email with questions.'
    });
    expect(transactionalCopyFor(brand.brand, 'shipping', 'fr', 'en').intro).toBe('Your parcel is off!');
    // A blank entry is no entry; the other emails are untouched.
    expect(transactionalCopyFor(brand.brand, 'refund', 'en', 'en')).toEqual({ intro: null, footer: null });
    expect(transactionalCopyFor(brand.brand, 'confirmation', 'en', 'en')).toEqual({ intro: null, footer: null });
  });

  it('refuses a tag the customer emails do not know', () => {
    const result = parseEmailBrand({ copy: { shipping: { intro: { en: 'Hi {{subscriber.first_name}}' } } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].message).toContain('Unknown tag');
    expect(parseEmailBrand({ copy: { shipping: { intro: { en: 'Hi {{customer.first_name|there}}' } } } }).ok).toBe(true);
  });

  it('refuses wording that is too long', () => {
    expect(parseEmailBrand({ copy: { refund: { intro: { en: 'x'.repeat(1001) } } } }).ok).toBe(false);
  });
});
