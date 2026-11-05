import { afterEach, describe, expect, it } from 'vitest';

import { newsletterStatus } from './config';
import { confirmUrl, listUnsubscribeHeaders, oneClickUnsubscribeUrl, unsubscribePreviewUrl, unsubscribeUrl } from './links';

describe('subscriber links', () => {
  it('point at the pages in the subscriber\'s language', () => {
    expect(confirmUrl('https://shop.example/', 'de-at', 'v1.a.b')).toBe('https://shop.example/de-at/newsletter/confirm?t=v1.a.b');
    expect(unsubscribeUrl('https://shop.example', 'ar', 'v1.a.b')).toBe('https://shop.example/ar/newsletter/unsubscribe?t=v1.a.b');
    expect(unsubscribePreviewUrl('https://shop.example', 'en')).toBe('https://shop.example/en/newsletter/unsubscribe?preview=1');
  });

  it('give mail clients a one-click POST address (RFC 8058)', () => {
    expect(oneClickUnsubscribeUrl('https://shop.example', 'de', 'v1.a.b')).toBe('https://shop.example/api/email/unsubscribe?t=v1.a.b&l=de');
    expect(listUnsubscribeHeaders('https://shop.example', 'de', 'v1.a.b')).toEqual({
      'List-Unsubscribe': '<https://shop.example/api/email/unsubscribe?t=v1.a.b&l=de>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    });
  });
});

describe('newsletterStatus', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const ready = { RESEND_API_KEY: 're_x', EMAIL_FROM: 'Shop <s@example.com>', EMAIL_SIGNING_SECRET: 'x'.repeat(40), NEXT_PUBLIC_SITE_URL: 'https://shop.example/' };

  it('is on with email, a secret and a site address', () => {
    process.env = { ...env, ...ready };
    expect(newsletterStatus(process.env)).toEqual({ enabled: true, secret: 'x'.repeat(40), siteUrl: 'https://shop.example' });
  });

  it('says what is missing', () => {
    process.env = { ...env, ...ready, RESEND_API_KEY: '' };
    expect(newsletterStatus(process.env)).toEqual({ enabled: false, reason: 'email-not-configured' });
    process.env = { ...env, ...ready, EMAIL_SIGNING_SECRET: '', NEXTAUTH_SECRET: '' };
    expect(newsletterStatus(process.env)).toEqual({ enabled: false, reason: 'no-signing-secret' });
    process.env = { ...env, ...ready, NEXT_PUBLIC_SITE_URL: 'shop.example' };
    expect(newsletterStatus(process.env)).toEqual({ enabled: false, reason: 'no-site-url' });
  });
});
