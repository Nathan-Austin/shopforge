import { describe, expect, it } from 'vitest';

import {
  availabilityFor,
  breadcrumbJsonLd,
  gtinProperty,
  itemListJsonLd,
  merchantListingProblems,
  onlineStoreJsonLd,
  priceString,
  productJsonLd,
  serializeJsonLd,
  webSiteJsonLd,
  type ProductJsonLdInput
} from './jsonld';

const input: ProductJsonLdInput = {
  url: 'https://shop.example/en/shop/ghost-pepper-sauce',
  name: 'Ghost Pepper Sauce',
  description: 'Hot.',
  images: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
  sku: 'GPS-250',
  barcode: '4006381333931',
  brand: 'Ember',
  category: 'Smoky',
  priceCents: 1299,
  currency: 'eur',
  availability: 'InStock',
  shipping: { rateCents: 500, currency: 'EUR', countries: ['DE', 'at'] },
  sellerName: 'Test Shop'
};

describe('productJsonLd', () => {
  const product = productJsonLd(input);
  const offer = product.offers as Record<string, unknown>;

  it('meets the merchant listing minimums', () => {
    expect(merchantListingProblems(product)).toEqual([]);
    expect(product['@type']).toBe('Product');
    expect(product.image).toEqual(input.images);
    expect(offer['@type']).toBe('Offer');
    expect(offer.price).toBe('12.99');
    expect(offer.priceCurrency).toBe('EUR');
    expect(offer.url).toBe(input.url);
  });

  it('emits identifiers Google asks for: sku, mpn, the right gtin field, a Brand', () => {
    expect(product.sku).toBe('GPS-250');
    expect(product.mpn).toBe('GPS-250');
    expect(product.gtin13).toBe('4006381333931');
    expect(product.brand).toEqual({ '@type': 'Brand', name: 'Ember' });
    expect(product.category).toBe('Smoky');
  });

  it('uses schema.org URLs for availability and condition', () => {
    expect(offer.availability).toBe('https://schema.org/InStock');
    expect(offer.itemCondition).toBe('https://schema.org/NewCondition');
    expect((productJsonLd({ ...input, availability: 'OutOfStock' }).offers as Record<string, unknown>).availability).toBe(
      'https://schema.org/OutOfStock'
    );
  });

  it('nests shipping details with uppercase countries and the same currency', () => {
    expect(offer.shippingDetails).toEqual({
      '@type': 'OfferShippingDetails',
      shippingRate: { '@type': 'MonetaryAmount', value: '5.00', currency: 'EUR' },
      shippingDestination: [
        { '@type': 'DefinedRegion', addressCountry: 'DE' },
        { '@type': 'DefinedRegion', addressCountry: 'AT' }
      ]
    });
  });

  it('adds a return policy only when the shop has one', () => {
    expect(offer.hasMerchantReturnPolicy).toBeUndefined();
    const withReturns = productJsonLd({ ...input, returnPolicy: { country: 'de', days: 14, fees: 'free' } });
    expect((withReturns.offers as Record<string, unknown>).hasMerchantReturnPolicy).toMatchObject({
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'DE',
      merchantReturnDays: 14,
      returnFees: 'https://schema.org/FreeReturn'
    });
  });

  it('leaves out what it does not have rather than emitting empties', () => {
    const bare = productJsonLd({ ...input, sku: '  ', barcode: null, brand: null, category: null, description: null, shipping: null });
    expect(bare).not.toHaveProperty('sku');
    expect(bare).not.toHaveProperty('mpn');
    expect(bare).not.toHaveProperty('gtin13');
    expect(bare).not.toHaveProperty('brand');
    expect(bare).not.toHaveProperty('description');
    expect(bare.offers).not.toHaveProperty('shippingDetails');
    expect(merchantListingProblems(bare)).toEqual([]);
  });
});

describe('gtinProperty', () => {
  it('picks the field by GS1 length and ignores anything else', () => {
    expect(gtinProperty('12345678')).toEqual({ gtin8: '12345678' });
    expect(gtinProperty('012345678905')).toEqual({ gtin12: '012345678905' });
    expect(gtinProperty('4006381333931')).toEqual({ gtin13: '4006381333931' });
    expect(gtinProperty('1 4006381 333938')).toEqual({ gtin14: '14006381333938' });
    expect(gtinProperty('ABC-123')).toEqual({});
    expect(gtinProperty('123456789')).toEqual({});
    expect(gtinProperty(null)).toEqual({});
  });
});

describe('priceString / availabilityFor', () => {
  it('formats cents as a dotted decimal and maps stock status', () => {
    expect(priceString(1299)).toBe('12.99');
    expect(priceString(500)).toBe('5.00');
    expect(priceString(-3)).toBe('0.00');
    expect(availabilityFor('in_stock')).toBe('InStock');
    expect(availabilityFor('low_stock')).toBe('InStock');
    expect(availabilityFor('backorder')).toBe('BackOrder');
    expect(availabilityFor('sold_out')).toBe('OutOfStock');
  });
});

describe('merchantListingProblems', () => {
  it('names each thing Google would reject', () => {
    const bad = {
      '@type': 'Product',
      image: ['/relative.jpg'],
      offers: { '@type': 'Offer', price: '0.00', priceCurrency: 'euro', availability: 'InStock', url: '/x' },
      brand: { '@type': 'Thing', name: 'x' },
      gtin13: 'abc'
    };
    expect(merchantListingProblems(bad)).toEqual([
      'missing name',
      'image is not an absolute URL',
      'offer price must be a positive decimal string',
      'priceCurrency is not ISO 4217',
      'availability is not a schema.org value',
      'offer url is not absolute',
      'brand is not a Brand',
      'gtin13 is not numeric'
    ]);
    expect(merchantListingProblems({ '@type': 'Product', name: 'x', image: ['https://a/b.jpg'] })).toEqual([
      'offers is not an Offer'
    ]);
  });

  it('flags a price validity date in the past', () => {
    const product = productJsonLd({ ...input, priceValidUntil: '2020-01-01' });
    expect(merchantListingProblems(product)).toEqual(['priceValidUntil is in the past']);
  });
});

describe('breadcrumbJsonLd / itemListJsonLd', () => {
  it('numbers positions from one and omits the item URL for the current page', () => {
    const crumbs = breadcrumbJsonLd([
      { name: 'Home', url: 'https://shop.example/en' },
      { name: 'Shop', url: 'https://shop.example/en/shop' },
      { name: 'Ghost Pepper Sauce' }
    ]);
    expect(crumbs['@type']).toBe('BreadcrumbList');
    expect(crumbs.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://shop.example/en' },
      { '@type': 'ListItem', position: 2, name: 'Shop', item: 'https://shop.example/en/shop' },
      { '@type': 'ListItem', position: 3, name: 'Ghost Pepper Sauce' }
    ]);
  });

  it('lists detail page URLs in order', () => {
    const list = itemListJsonLd({
      name: 'Shop',
      url: 'https://shop.example/en/shop',
      items: [
        { name: 'A', url: 'https://shop.example/en/shop/a' },
        { name: 'B', url: 'https://shop.example/en/shop/b' }
      ]
    });
    expect(list.numberOfItems).toBe(2);
    expect((list.itemListElement as unknown[])[1]).toEqual({
      '@type': 'ListItem',
      position: 2,
      name: 'B',
      url: 'https://shop.example/en/shop/b'
    });
  });
});

describe('onlineStoreJsonLd / webSiteJsonLd', () => {
  it('describes the store once with its shipping policy', () => {
    const store = onlineStoreJsonLd({
      name: 'Test Shop',
      url: 'https://shop.example/en',
      logo: 'https://shop.example/logo.png',
      shipping: { rateCents: 0, currency: 'eur', countries: ['de'] }
    });
    expect(store['@type']).toBe('OnlineStore');
    expect(store.hasShippingService).toMatchObject({
      '@type': 'ShippingService',
      shippingRate: { value: '0.00', currency: 'EUR' }
    });
    expect(webSiteJsonLd({ name: 'Test Shop', url: 'https://shop.example/en', inLanguage: 'en' })).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Test Shop',
      url: 'https://shop.example/en',
      inLanguage: 'en'
    });
  });
});

describe('serializeJsonLd', () => {
  it('cannot be broken out of by a product name containing a script tag', () => {
    const out = serializeJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c/script');
    expect(JSON.parse(out)).toEqual({ name: '</script><script>alert(1)</script>' });
  });
});
