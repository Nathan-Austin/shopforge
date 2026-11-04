import { describe, expect, it } from 'vitest';

import { buildMerchantFeed, escapeXml, feedItem, type FeedProduct } from './merchantFeed';

const product: FeedProduct = {
  id: 'p1',
  title: 'Ghost Pepper Sauce',
  description: 'Hot & smoky',
  link: 'https://shop.example/en/shop/ghost-pepper-sauce',
  images: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
  priceCents: 1299,
  currency: 'eur',
  availability: 'InStock',
  brand: 'Ember',
  sku: 'GPS-250',
  barcode: '4006381333931',
  category: 'Smoky',
  shippingWeightGrams: 350
};

describe('feedItem', () => {
  const xml = feedItem(product);

  it('carries the seven required attributes', () => {
    for (const tag of ['g:id', 'g:title', 'g:description', 'g:link', 'g:image_link', 'g:price', 'g:availability']) {
      expect(xml).toContain(`<${tag}>`);
    }
    expect(xml).toContain('<g:price>12.99 EUR</g:price>');
    expect(xml).toContain('<g:availability>in_stock</g:availability>');
    expect(xml).toContain('<g:image_link>https://cdn.example/a.jpg</g:image_link>');
    expect(xml).toContain('<g:additional_image_link>https://cdn.example/b.jpg</g:additional_image_link>');
  });

  it('includes identifiers, condition, brand, type and weight', () => {
    expect(xml).toContain('<g:gtin>4006381333931</g:gtin>');
    expect(xml).toContain('<g:mpn>GPS-250</g:mpn>');
    expect(xml).toContain('<g:brand>Ember</g:brand>');
    expect(xml).toContain('<g:condition>new</g:condition>');
    expect(xml).toContain('<g:product_type>Smoky</g:product_type>');
    expect(xml).toContain('<g:shipping_weight>350 g</g:shipping_weight>');
    expect(xml).not.toContain('identifier_exists');
  });

  it('says identifier_exists=no when there is no GTIN or SKU', () => {
    const bare = feedItem({ ...product, sku: null, barcode: null, brand: null });
    expect(bare).toContain('<g:identifier_exists>no</g:identifier_exists>');
    expect(bare).not.toContain('<g:gtin>');
    expect(bare).not.toContain('<g:brand>');
  });

  it('drops an invalid barcode rather than submitting it', () => {
    expect(feedItem({ ...product, barcode: 'ABC-1' })).not.toContain('<g:gtin>');
  });

  it('escapes XML and maps the other availabilities', () => {
    expect(xml).toContain('Hot &amp; smoky');
    expect(feedItem({ ...product, availability: 'OutOfStock' })).toContain('out_of_stock');
    expect(feedItem({ ...product, availability: 'BackOrder' })).toContain('backorder');
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });

  it('falls back to the title when there is no description and clips long titles', () => {
    const item = feedItem({ ...product, description: null, title: 'x'.repeat(200) });
    expect(item).toMatch(/<g:title>x{149}…<\/g:title>/);
    expect(item).toMatch(/<g:description>x{149}…<\/g:description>/);
  });
});

describe('buildMerchantFeed', () => {
  it('wraps items in an RSS 2.0 channel with the Google namespace', () => {
    const feed = buildMerchantFeed({
      shopName: 'Test & Shop',
      shopUrl: 'https://shop.example/en',
      products: [product, { ...product, id: 'p2' }]
    });
    expect(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(feed).toContain('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">');
    expect(feed).toContain('<title>Test &amp; Shop</title>');
    expect(feed).toContain('<link>https://shop.example/en</link>');
    expect(feed.match(/<item>/g)).toHaveLength(2);
    expect(feed.trim().endsWith('</rss>')).toBe(true);
  });
});
