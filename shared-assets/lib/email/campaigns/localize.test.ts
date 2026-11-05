import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { formatPrice } from '../../format';
import { sampleContext, sampleDocument } from './fixtures';
import { localeFallbackChain, pickLocalized, isBlankString } from './localize';
import { campaignStrings, renderCampaign, type CampaignRenderResult } from './render';

function rendered(result: CampaignRenderResult) {
  if (!result.ok) throw new Error(`Expected a rendered email, got ${result.error}`);
  return result.email;
}

type Translate = (key: string, values?: Record<string, string>) => string;

/** next-intl's own translator over a messages object, as the server uses it. */
function campaignTranslator(locale: string, messages: Record<string, unknown>): Translate {
  const t = createTranslator({ locale, messages: messages as never, namespace: 'Email.campaign' as never });
  return (key, values) => (t as unknown as Translate)(key, values);
}

describe('localeFallbackChain', () => {
  it('goes market, language, default', () => {
    expect(localeFallbackChain('de-at', 'en')).toEqual(['de-at', 'de', 'en']);
  });

  it('does not repeat itself', () => {
    expect(localeFallbackChain('en', 'en')).toEqual(['en']);
    expect(localeFallbackChain('de', 'de-at')).toEqual(['de', 'de-at']);
  });

  it('normalises what it is given', () => {
    expect(localeFallbackChain('DE_AT', 'EN')).toEqual(['de-at', 'de', 'en']);
  });
});

describe('pickLocalized', () => {
  const text = { en: 'Hello', de: 'Hallo', 'de-ch': '   ' };

  it('takes the exact locale when it has text', () => {
    expect(pickLocalized(text, 'de', 'en', isBlankString)).toEqual({ value: 'Hallo', locale: 'de', fellBack: false });
  });

  it('skips an empty market entry for its language, which is not a fallback', () => {
    expect(pickLocalized(text, 'de-ch', 'en', isBlankString)).toEqual({ value: 'Hallo', locale: 'de', fellBack: false });
  });

  it('reports falling back to another language', () => {
    expect(pickLocalized(text, 'tr', 'en', isBlankString)).toEqual({ value: 'Hello', locale: 'en', fellBack: true });
  });

  it('is null when nothing in the chain has text', () => {
    expect(pickLocalized({ fr: 'Bonjour' }, 'de', 'en', isBlankString)).toBeNull();
    expect(pickLocalized(undefined, 'de', 'en', isBlankString)).toBeNull();
  });
});

describe('rendering per locale', () => {
  it('uses the German text, German merge-tag fallbacks and German prices', () => {
    const email = rendered(
      renderCampaign(sampleDocument(), sampleContext({ locale: 'de', recipient: { email: 'kim@example.com' } }))
    );
    expect(email.subject).toBe('Neu bei Your Shop');
    expect(email.preheader).toBe('Frische Ware und 15 % Rabatt');
    expect(email.html).toContain('Hallo du!');
    expect(email.html).toContain('Diesen Monat: große Neuigkeiten.');
    expect(email.html).toContain('Jetzt einkaufen');
    expect(email.html).toContain(formatPrice(899, 'EUR', 'de'));
    expect(email.html).toContain('lang="de"');
  });

  it('falls back to the default language per field, and says where', () => {
    const email = rendered(renderCampaign(sampleDocument(), sampleContext({ locale: 'de' })));
    // The column contents and the image alt text have no German.
    expect(email.html).toContain('Left column');
    expect(email.html).toContain('Right button');
    expect(email.warnings).toEqual(
      expect.arrayContaining([
        { code: 'missing-translation', blockId: 'c1', detail: 'text:en' },
        { code: 'missing-translation', blockId: 'c2', detail: 'label:en' },
        { code: 'missing-translation', blockId: 'img', detail: 'alt:en' },
        { code: 'missing-translation', detail: 'footer:en' }
      ])
    );
    expect(email.warnings).not.toContainEqual(expect.objectContaining({ blockId: 'h1' }));
  });

  it('gives a market its language without calling it a fallback', () => {
    const email = rendered(renderCampaign(sampleDocument(), sampleContext({ locale: 'de-at' })));
    expect(email.subject).toBe('Neu bei Your Shop');
    expect(email.html).toContain('lang="de-AT"');
    expect(email.warnings).not.toContainEqual(expect.objectContaining({ blockId: 'h1' }));
    expect(email.warnings).not.toContainEqual({ code: 'missing-translation', detail: 'subject:de' });
  });

  it('lays Arabic out right to left', () => {
    const email = rendered(renderCampaign(sampleDocument(), sampleContext({ locale: 'ar' })));
    expect(email.subject).toBe('جديد في Your Shop');
    expect(email.dir).toBe('rtl');
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    // "start" alignment is the right-hand side in a right-to-left email.
    expect(email.html).toMatch(/<h3 [^>]*text-align:right;[^>]*>Left column<\/h3>/);
    expect(email.html).toContain(formatPrice(899, 'EUR', 'ar'));
  });
});

describe('Email.campaign messages through next-intl', () => {
  const fixtures: Record<string, Record<string, unknown>> = {
    en: {
      Email: {
        campaign: {
          footerReason: 'You are receiving this email because you subscribed to news from {shop}.',
          unsubscribe: 'Unsubscribe',
          viewProduct: 'View product',
          discountTitle: 'Your code',
          discountHint: 'Enter it in your cart or at checkout.'
        }
      }
    },
    de: {
      Email: {
        campaign: {
          footerReason: 'Sie erhalten diese E-Mail, weil Sie Neuigkeiten von {shop} abonniert haben.',
          unsubscribe: 'Abmelden',
          viewProduct: 'Zum Produkt',
          discountTitle: 'Ihr Code',
          discountHint: 'Geben Sie ihn im Warenkorb oder an der Kasse ein.'
        }
      }
    }
  };

  it('fills {shop} in the locale asked for', () => {
    const strings = campaignStrings(campaignTranslator('de', fixtures.de), 'Chilli & Co');
    expect(strings.footerReason).toBe('Sie erhalten diese E-Mail, weil Sie Neuigkeiten von Chilli & Co abonniert haben.');
    expect(strings.unsubscribe).toBe('Abmelden');
  });

  it('puts the translated wording into the rendered email, escaped', () => {
    const strings = campaignStrings(campaignTranslator('de', fixtures.de), 'Chilli & Co');
    const email = rendered(renderCampaign(sampleDocument(), sampleContext({ locale: 'de', strings })));
    expect(email.html).toContain('Neuigkeiten von Chilli &amp; Co abonniert haben.');
    expect(email.html).toContain('>Abmelden</a>');
    expect(email.text).toContain('Abmelden: https://shop.example/unsubscribe?t=abc');
  });

  // The shop's own files: every language that ships must interpolate.
  const messagesDir = path.join(process.cwd(), 'src/messages');
  const languages = ['en', 'de', 'tr', 'ar'].filter((language) => existsSync(path.join(messagesDir, `${language}.json`)));

  it.each(languages)('%s.json has every campaign string, with {shop} filled', (language) => {
    const messages = JSON.parse(readFileSync(path.join(messagesDir, `${language}.json`), 'utf8'));
    const strings = campaignStrings(campaignTranslator(language, messages), 'Test Shop');
    for (const value of Object.values(strings)) {
      expect(value.trim()).not.toBe('');
      expect(value).not.toMatch(/[{}]/);
      expect(value).not.toContain('Email.campaign');
    }
    expect(strings.footerReason).toContain('Test Shop');
  });
});
