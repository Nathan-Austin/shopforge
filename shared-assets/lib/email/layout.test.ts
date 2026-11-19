import { describe, expect, it } from 'vitest';

import { DEFAULT_EMAIL_BRAND } from './brand';
import { emailButton, emailStyles, renderTransactionalEmail } from './layout';

const body = { html: '<p>Hello</p>', text: 'Hello' };

describe('renderTransactionalEmail', () => {
  it('uses the default brand when none is given', () => {
    const { html } = renderTransactionalEmail({ locale: 'en', subject: 'Hi', shopName: 'Test Shop', body });
    expect(html).toContain(`background:${DEFAULT_EMAIL_BRAND.backgroundColor}`);
    expect(html).toContain(`background:${DEFAULT_EMAIL_BRAND.contentColor}`);
    expect(html).not.toContain('<img');
    expect(html).toContain('<html lang="en" dir="ltr">');
  });

  it('applies the brand colours and font', () => {
    const brand = { ...DEFAULT_EMAIL_BRAND, backgroundColor: '#123456', contentColor: '#fffff0', textColor: '#222222', fontFamily: 'serif' as const };
    const { html } = renderTransactionalEmail({ brand, locale: 'en', subject: 'Hi', shopName: 'Test Shop', body });
    expect(html).toContain('background:#123456');
    expect(html).toContain('background:#fffff0');
    expect(html).toContain('color:#222222');
    expect(html).toContain('Georgia');
  });

  it('shows the logo, linked to the shop, with the shop name as alt text', () => {
    const brand = { ...DEFAULT_EMAIL_BRAND, logoUrl: 'https://cdn.test/logo.png', logoWidth: 180 };
    const { html } = renderTransactionalEmail({
      brand,
      locale: 'en',
      subject: 'Hi',
      shopName: 'Ann & Co <shop>',
      shopUrl: 'https://shop.test',
      body
    });
    expect(html).toContain('<a href="https://shop.test"><img src="https://cdn.test/logo.png" alt="Ann &amp; Co &lt;shop&gt;" width="180"');
  });

  it('does not link the logo to anything but http(s)', () => {
    const brand = { ...DEFAULT_EMAIL_BRAND, logoUrl: 'https://cdn.test/logo.png' };
    const { html } = renderTransactionalEmail({ brand, locale: 'en', subject: 'Hi', shopName: 'Shop', shopUrl: 'javascript:alert(1)', body });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<img src="https://cdn.test/logo.png"');
  });

  it('puts the note and the address in the footer and the text tail, escaped', () => {
    const { html, text } = renderTransactionalEmail({
      locale: 'en',
      subject: 'Hi',
      shopName: 'Shop',
      body,
      footerNote: 'Questions? Reply to this email.',
      footerAddress: 'Test Shop Ltd\n1 High <Street>'
    });
    expect(html).toContain('Questions? Reply to this email.');
    expect(html).toContain('Test Shop Ltd\n1 High &lt;Street&gt;');
    expect(text).toBe('Hello\n\nQuestions? Reply to this email.\n\nTest Shop Ltd\n1 High <Street>');
  });

  it('leaves the footer out when there is nothing to say', () => {
    const { html, text } = renderTransactionalEmail({ locale: 'en', subject: 'Hi', shopName: 'Shop', body, footerNote: '  ' });
    expect(html).not.toContain('font-size:12px');
    expect(text).toBe('Hello');
  });

  it('is right-to-left for Arabic', () => {
    const { html } = renderTransactionalEmail({ locale: 'ar', subject: 'مرحبا', shopName: 'Shop', body });
    expect(html).toContain('<html lang="ar" dir="rtl">');
  });
});

describe('emailButton', () => {
  it('fills the button with the brand colour and picks a readable label colour', () => {
    const dark = emailStyles({ ...DEFAULT_EMAIL_BRAND, brandColor: '#112233' });
    expect(emailButton('View', 'https://shop.test/o/1', dark)).toContain('background:#112233;color:#ffffff');
    const light = emailStyles({ ...DEFAULT_EMAIL_BRAND, brandColor: '#ffee88' });
    expect(emailButton('View', 'https://shop.test/o/1', light)).toContain('background:#ffee88;color:#000000');
  });

  it('escapes the label and the address', () => {
    const html = emailButton('<b>', 'https://shop.test/?a=1&b=2', emailStyles());
    expect(html).toContain('href="https://shop.test/?a=1&amp;b=2"');
    expect(html).toContain('>&lt;b&gt;</a>');
  });
});
