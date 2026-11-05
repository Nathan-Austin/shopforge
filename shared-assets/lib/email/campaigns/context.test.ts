import { describe, expect, it } from 'vitest';

import type { DiscountCode } from '../../discounts/rules';
import { formatPrice } from '../../format';
import {
  campaignDiscounts,
  describeDiscount,
  designerPreviewContext,
  previewUnsubscribeUrl,
  sampleSubscriberValues,
  toCampaignProduct,
  toCatalogProduct,
  type DesignerData,
  type DiscountWording
} from './context';
import { sampleDocument } from './fixtures';
import { renderCampaign } from './render';

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ghost Pepper Sauce',
  slug: 'ghost pepper',
  price_cents: 899,
  compare_at_price_cents: null,
  currency: null,
  image_url: 'https://cdn.example/ghost.jpg'
};

describe('toCampaignProduct', () => {
  it('links to the product in the recipient\'s language', () => {
    expect(toCampaignProduct(row, { locale: 'de-at', siteUrl: 'https://shop.example/', extras: ['🌶 Hot (8/10)', ' '] })).toEqual({
      id: row.id,
      name: 'Ghost Pepper Sauce',
      url: 'https://shop.example/de-at/shop/ghost%20pepper',
      priceCents: 899,
      compareAtPriceCents: null,
      currency: 'EUR',
      imageUrl: 'https://cdn.example/ghost.jpg',
      extras: ['🌶 Hot (8/10)']
    });
  });

  it('is null when the shop has no address to link to', () => {
    expect(toCampaignProduct(row, { locale: 'en', siteUrl: null })).toBeNull();
    expect(toCampaignProduct(row, { locale: 'en', siteUrl: '' })).toBeNull();
  });
});

const wording: DiscountWording = {
  percent: (percent) => `${percent}% off`,
  amount: (amount) => `${amount} off`,
  freeShipping: 'Free shipping'
};

function code(overrides: Partial<DiscountCode>): DiscountCode {
  return {
    id: 'x',
    code: 'SPRING15',
    kind: 'percent',
    percentOff: 15,
    amountOffCents: null,
    currency: null,
    minSubtotalCents: null,
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    redemptionCount: 0,
    active: true,
    ...overrides
  };
}

describe('describeDiscount', () => {
  it('formats percent and amount for the locale', () => {
    expect(describeDiscount(code({ percentOff: 12.5 }), wording, 'de')).toBe('12,5% off');
    expect(describeDiscount(code({ kind: 'amount', amountOffCents: 500, currency: 'EUR' }), wording, 'de')).toBe(
      `${formatPrice(500, 'EUR', 'de')} off`
    );
    expect(describeDiscount(code({ kind: 'free_shipping' }), wording, 'en')).toBe('Free shipping');
  });
});

describe('campaignDiscounts', () => {
  const now = new Date('2026-11-05T12:00:00Z');

  it('keeps live and upcoming codes, drops the rest', () => {
    const codes = [
      code({ code: 'LIVE' }),
      code({ code: 'SOON', startsAt: '2026-12-01T00:00:00Z' }),
      code({ code: 'RETIRED', active: false }),
      code({ code: 'OVER', endsAt: '2026-11-01T00:00:00Z' }),
      code({ code: 'USEDUP', maxRedemptions: 5, redemptionCount: 5 })
    ];
    expect(campaignDiscounts(codes, wording, 'en', now)).toEqual({
      LIVE: { code: 'LIVE', label: '15% off' },
      SOON: { code: 'SOON', label: '15% off' }
    });
  });
});

describe('sampleSubscriberValues', () => {
  it('only fills subscriber tags', () => {
    expect(sampleSubscriberValues()).toEqual({ 'subscriber.first_name': 'Alex', 'subscriber.email': 'alex@example.com' });
  });
});

describe('designerPreviewContext', () => {
  const data: DesignerData = {
    shop: { name: 'Test Shop', url: 'https://shop.example' },
    catalog: [toCatalogProduct(row, ['🌶 Hot (8/10)'])],
    discounts: [{ code: 'SPRING15', status: 'active' }],
    locales: {
      en: {
        strings: { footerReason: 'Subscribed to Test Shop.', unsubscribe: 'Unsubscribe', viewProduct: 'View product', discountTitle: 'Your code', discountHint: 'At checkout.' },
        discountLabels: { SPRING15: '15% off' }
      },
      de: {
        strings: { footerReason: 'Abonniert bei Test Shop.', unsubscribe: 'Abmelden', viewProduct: 'Zum Produkt', discountTitle: 'Ihr Code', discountHint: 'An der Kasse.' },
        discountLabels: { SPRING15: '15 % Rabatt' }
      }
    }
  };

  it('builds the same context a test send gets, in the language asked for', () => {
    const context = designerPreviewContext(data, 'de', 'en');
    expect(context.strings.unsubscribe).toBe('Abmelden');
    expect(context.discounts).toEqual({ SPRING15: { code: 'SPRING15', label: '15 % Rabatt' } });
    expect(context.products[row.id]?.url).toBe('https://shop.example/de/shop/ghost%20pepper');
    expect(context.products[row.id]?.extras).toEqual(['🌶 Hot (8/10)']);
    expect(context.unsubscribeUrl).toBe('https://shop.example/de/newsletter/unsubscribe?preview=1');
    expect(context.mergeValues).toEqual(sampleSubscriberValues());
    expect(context.recipient).toBeNull();
  });

  it('falls back to the default language\'s wording for a market without its own', () => {
    expect(designerPreviewContext(data, 'fr', 'en').strings.unsubscribe).toBe('Unsubscribe');
  });

  it('renders the sample campaign with it', () => {
    const result = renderCampaign(sampleDocument(), designerPreviewContext(data, 'de', 'en'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.email.html).toContain('15 % Rabatt');
      expect(result.email.html).toContain('Hallo Alex!');
    }
  });

  it('has no products to link without a site address', () => {
    expect(designerPreviewContext({ ...data, shop: { name: 'S', url: null } }, 'en', 'en').products).toEqual({});
  });
});

describe('previewUnsubscribeUrl', () => {
  it('is the unsubscribe page in preview mode, in that language', () => {
    expect(previewUnsubscribeUrl('https://shop.example/', 'de-at')).toBe('https://shop.example/de-at/newsletter/unsubscribe?preview=1');
    expect(previewUnsubscribeUrl(null, 'en')).toBeNull();
  });
});
