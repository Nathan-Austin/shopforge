import { describe, expect, it } from 'vitest';

import { paragraph, PRODUCT_ID, sampleContext, sampleDocument } from './fixtures';
import { contrastingText, renderCampaign, type CampaignRenderResult } from './render';
import type { CampaignDocumentInput } from './schema';

function rendered(result: CampaignRenderResult) {
  if (!result.ok) throw new Error(`Expected a rendered email, got ${result.error}: ${JSON.stringify(result.issues)}`);
  return result.email;
}

function withBlocks(blocks: unknown[]): CampaignDocumentInput {
  return { ...sampleDocument(), blocks: blocks as CampaignDocumentInput['blocks'] };
}

describe('renderCampaign', () => {
  it('renders subject, preheader, HTML and text with merge tags filled', () => {
    const email = rendered(renderCampaign(sampleDocument(), sampleContext()));
    expect(email.subject).toBe('New in at Your Shop');
    expect(email.preheader).toBe('Fresh stock and 15% off');
    expect(email.html).toContain('Hi Alex!');
    expect(email.text).toContain('Hi Alex!');
    expect(email.html).toContain('<title>New in at Your Shop</title>');
    expect(email.warnings).toEqual([]);
  });

  it('renders the rich text marks as tags', () => {
    const { html, text } = rendered(renderCampaign(sampleDocument(), sampleContext()));
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<u>underlined</u>');
    expect(html).toContain('<span style="font-size:24px;">big</span>');
    // {{shop.url}} has its trailing slash removed before the path is added.
    expect(html).toContain('href="https://shop.example/en/shop"');
    expect(html).toMatch(/<ul [^>]*>[\s\S]*Free shipping over 50[\s\S]*<\/ul>/);
    expect(text).toContain('See the shop (https://shop.example/en/shop)');
    expect(text).toContain('- Free shipping over 50');
  });

  it('renders product, discount, columns, button and footer', () => {
    const { html, text } = rendered(renderCampaign(sampleDocument(), sampleContext()));
    expect(html).toContain('Ghost Pepper Sauce');
    expect(html).toContain('Hot · 8/10');
    expect(html).toContain('€8.99');
    expect(html).toContain('<s style="opacity:0.6;">€10.99</s>');
    expect(html).toContain('SPRING15');
    expect(html).toContain('15% off');
    expect(html).toContain('class="sf-col"');
    expect(html).toContain('Right button');
    expect(html).toContain('href="https://shop.example/unsubscribe?t=abc"');
    expect(html).toContain('Musterstraße 1, 10115 Berlin');
    expect(text).toContain('Shop now: https://shop.example/en/shop');
    expect(text).toContain('Unsubscribe: https://shop.example/unsubscribe?t=abc');
  });

  it('stacks columns on phones unless told not to', () => {
    const doc = withBlocks([
      { id: 'c', type: 'columns', stackOnMobile: false, columns: [[{ id: 'a', type: 'heading', text: { en: 'A' } }], []] }
    ]);
    const { html } = rendered(renderCampaign(doc, sampleContext()));
    expect(html).toContain('@media only screen and (max-width:620px)');
    expect(html).not.toContain('class="sf-col"');
  });

  it('picks black or white button text for contrast', () => {
    expect(contrastingText('#111111')).toBe('#ffffff');
    expect(contrastingText('#fde047')).toBe('#000000');
    expect(contrastingText('#b91c1c')).toBe('#ffffff');
  });

  it('escapes everything that came from people', () => {
    const doc = withBlocks([
      { id: 'h', type: 'heading', text: { en: '<script>alert(1)</script> {{subscriber.first_name}}' } },
      { id: 't', type: 'text', content: { en: paragraph('Tom & "Jerry" <b>') } }
    ]);
    const context = sampleContext({
      recipient: { email: 'x@example.com', firstName: '<img src=x onerror=alert(1)>' },
      shop: { name: 'A & B "Shop"', url: 'https://shop.example' }
    });
    const { html } = rendered(renderCampaign(doc, context));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Tom &amp; &quot;Jerry&quot; &lt;b&gt;');
  });

  it('links {{shop.locale_url}} to the shop in the recipient\'s language', () => {
    const doc = withBlocks([{ id: 'b', type: 'button', label: { en: 'Shop' }, href: '{{shop.locale_url}}/shop' }]);
    expect(rendered(renderCampaign(doc, sampleContext({ locale: 'de-at' }))).html).toContain('href="https://shop.example/de-at/shop"');
    expect(rendered(renderCampaign(doc, sampleContext({ locale: 'en' }))).text).toContain('Shop: https://shop.example/en/shop');
  });

  it('writes {{current_year}} from the given clock', () => {
    const doc = { ...sampleDocument(), footer: { en: '© {{current_year}} {{shop.name}}' } };
    expect(rendered(renderCampaign(doc, sampleContext())).text).toContain('© 2026 Your Shop');
  });

  it('uses the preview sample values when given', () => {
    const email = rendered(renderCampaign(sampleDocument(), sampleContext({ recipient: null, mergeValues: { 'subscriber.first_name': 'Sample' } })));
    expect(email.html).toContain('Hi Sample!');
  });

  it('uses the merge-tag fallback when the subscriber has no name', () => {
    const email = rendered(renderCampaign(sampleDocument(), sampleContext({ recipient: { email: 'x@example.com' } })));
    expect(email.html).toContain('Hi there!');
  });
});

describe('renderCampaign error fallbacks', () => {
  it('refuses a document with no usable subject, with the reason', () => {
    const result = renderCampaign({ ...sampleDocument(), subject: {} }, sampleContext());
    expect(result).toMatchObject({ ok: false, error: 'invalid-document' });
    expect(!result.ok && result.issues).toEqual([{ path: 'subject.en', message: 'The subject needs text in the default language (en)' }]);
  });

  it.each([null, undefined, 'campaign', 42, [], { version: 1 }])('refuses %j without throwing', (input) => {
    expect(renderCampaign(input, sampleContext())).toMatchObject({ ok: false, error: 'invalid-document' });
  });

  it('drops an invalid block and renders the rest', () => {
    const doc = withBlocks([
      { id: 'good', type: 'heading', text: { en: 'Still here' } },
      { id: 'bad', type: 'button', label: { en: 'Evil' }, href: 'javascript:alert(1)' },
      { id: 'odd', type: 'carousel' }
    ]);
    const email = rendered(renderCampaign(doc, sampleContext()));
    expect(email.html).toContain('Still here');
    expect(email.html).not.toContain('Evil');
    expect(email.html).not.toContain('javascript:');
    expect(email.warnings.map((w) => [w.code, w.blockId])).toEqual([
      ['invalid-block', 'bad'],
      ['invalid-block', 'odd']
    ]);
  });

  it('drops a bad child inside columns, keeping its neighbours', () => {
    const doc = withBlocks([
      {
        id: 'cols',
        type: 'columns',
        columns: [
          [{ id: 'ok', type: 'heading', text: { en: 'Kept' } }],
          [{ id: 'broken', type: 'image', src: 'http://insecure.example/x.png' }]
        ]
      }
    ]);
    const email = rendered(renderCampaign(doc, sampleContext()));
    expect(email.html).toContain('Kept');
    expect(email.html).not.toContain('insecure.example');
    expect(email.warnings).toContainEqual(expect.objectContaining({ code: 'invalid-block', blockId: 'broken' }));
  });

  it('drops a block whose product is gone', () => {
    const email = rendered(renderCampaign(sampleDocument(), sampleContext({ products: {} })));
    expect(email.html).not.toContain('Ghost Pepper Sauce');
    expect(email.warnings).toContainEqual({ code: 'missing-product', blockId: 'p1', detail: PRODUCT_ID });
    expect(email.html).toContain('Shop now');
  });

  it('drops a block whose discount code was retired', () => {
    const email = rendered(renderCampaign(sampleDocument(), sampleContext({ discounts: {} })));
    expect(email.html).not.toContain('SPRING15');
    expect(email.warnings).toContainEqual({ code: 'missing-discount', blockId: 'd1', detail: 'SPRING15' });
  });

  it('keeps going when a block throws while rendering', () => {
    const products = {};
    Object.defineProperty(products, PRODUCT_ID, {
      enumerable: true,
      get() {
        throw new Error('catalogue offline');
      }
    });
    const email = rendered(renderCampaign(sampleDocument(), sampleContext({ products })));
    expect(email.warnings).toContainEqual({ code: 'block-failed', blockId: 'p1', detail: 'catalogue offline' });
    expect(email.html).toContain('SPRING15');
  });

  it('renders an unknown merge tag from an old document as its fallback, with a warning', () => {
    // Saved before validation knew better: bypasses the strict schema.
    const doc = withBlocks([{ id: 'h', type: 'heading', text: { en: 'Hi {{customer.name|friend}}' } }]);
    const email = rendered(renderCampaign(doc, sampleContext()));
    expect(email.html).toContain('Hi friend');
    expect(email.html).not.toContain('{{');
    expect(email.warnings).toEqual([{ code: 'unknown-merge-tag', blockId: 'h', detail: 'customer.name' }]);
  });

  it('drops a link that interpolates to something unsafe', () => {
    const doc = withBlocks([
      { id: 'h', type: 'heading', text: { en: 'Hello' } },
      { id: 'b', type: 'button', label: { en: 'Go' }, href: '{{shop.url}}/x' }
    ]);
    const email = rendered(renderCampaign(doc, sampleContext({ shop: { name: 'S', url: null } })));
    expect(email.html).not.toContain('>Go</a>');
    expect(email.warnings).toContainEqual({ code: 'unsafe-url', blockId: 'b', detail: '/x' });
    expect(email.warnings).toContainEqual({ code: 'empty-block', blockId: 'b' });
  });

  it('still renders, with a warning, when there is no unsubscribe link', () => {
    const email = rendered(renderCampaign(sampleDocument(), sampleContext({ unsubscribeUrl: null })));
    expect(email.html).not.toContain('Unsubscribe');
    expect(email.warnings).toContainEqual({ code: 'missing-unsubscribe' });
  });

  it('refuses an email with nothing left to show', () => {
    const doc = withBlocks([{ id: 'p', type: 'product', productId: PRODUCT_ID }]);
    const result = renderCampaign(doc, sampleContext({ products: {} }));
    expect(result).toMatchObject({ ok: false, error: 'empty' });
    expect(!result.ok && result.warnings).toContainEqual(expect.objectContaining({ code: 'missing-product' }));
  });

  it('drops duplicate block ids found in a stored document', () => {
    const doc = withBlocks([
      { id: 'x', type: 'heading', text: { en: 'First' } },
      { id: 'x', type: 'heading', text: { en: 'Second' } }
    ]);
    const email = rendered(renderCampaign(doc, sampleContext()));
    expect(email.html).toContain('First');
    expect(email.html).not.toContain('Second');
    expect(email.warnings).toEqual([{ code: 'invalid-block', blockId: 'x', detail: 'Duplicate block id' }]);
  });
});
