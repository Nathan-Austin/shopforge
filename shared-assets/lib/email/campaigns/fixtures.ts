/**
 * A campaign that uses every block type, and the context to render it,
 * for the unit tests and the preview files they write. Not imported by
 * the app.
 */

import type { CampaignRenderContext } from './render';
import type { CampaignDocumentInput, RichDoc } from './schema';

export const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

export function paragraph(text: string): RichDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

export function sampleDocument(): CampaignDocumentInput {
  return {
    version: 1,
    defaultLocale: 'en',
    subject: { en: 'New in at {{shop.name}}', de: 'Neu bei {{shop.name}}', ar: 'جديد في {{shop.name}}' },
    preheader: { en: 'Fresh stock and 15% off', de: 'Frische Ware und 15 % Rabatt' },
    theme: { brandColor: '#b91c1c', logoUrl: 'https://cdn.example/logo.png' },
    footer: { en: 'Your Shop GmbH\nMusterstraße 1, 10115 Berlin' },
    blocks: [
      { id: 'h1', type: 'heading', level: 1, text: { en: 'Hi {{subscriber.first_name|there}}!', de: 'Hallo {{subscriber.first_name|du}}!' } },
      {
        id: 't1',
        type: 'text',
        content: {
          en: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'This month: ' },
                  { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
                  { type: 'text', text: ', ' },
                  { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
                  { type: 'text', text: ', ' },
                  { type: 'text', text: 'underlined', marks: [{ type: 'underline' }] },
                  { type: 'text', text: ' and ' },
                  { type: 'text', text: 'big', marks: [{ type: 'textStyle', attrs: { fontSize: '24px', color: null } }] },
                  { type: 'text', text: ' news. ' },
                  { type: 'text', text: 'See the shop', marks: [{ type: 'link', attrs: { href: '{{shop.url}}/en/shop' } }] }
                ]
              },
              {
                type: 'bulletList',
                content: [
                  { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Free shipping over 50' }] }] },
                  { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New sauces every week' }] }] }
                ]
              }
            ]
          },
          de: paragraph('Diesen Monat: große Neuigkeiten.')
        }
      },
      { id: 'img', type: 'image', src: 'https://cdn.example/banner.jpg', alt: { en: 'Our new range' }, href: '{{shop.url}}/en/shop' },
      { id: 'p1', type: 'product', productId: PRODUCT_ID },
      { id: 'd1', type: 'discount', code: 'SPRING15' },
      { id: 'div', type: 'divider' },
      {
        id: 'cols',
        type: 'columns',
        layout: '1-1',
        columns: [
          [{ id: 'c1', type: 'heading', level: 3, text: { en: 'Left column' } }],
          [{ id: 'c2', type: 'button', label: { en: 'Right button' }, href: 'https://shop.example/en/cart' }]
        ]
      },
      { id: 'sp', type: 'spacer', height: 16 },
      { id: 'btn', type: 'button', label: { en: 'Shop now', de: 'Jetzt einkaufen' }, href: '{{shop.url}}/en/shop' }
    ]
  };
}

export function sampleContext(overrides: Partial<CampaignRenderContext> = {}): CampaignRenderContext {
  return {
    locale: 'en',
    strings: {
      footerReason: 'You are receiving this email because you subscribed to news from Your Shop.',
      unsubscribe: 'Unsubscribe',
      viewProduct: 'View product',
      discountTitle: 'Your code',
      discountHint: 'Enter it in your cart or at checkout.'
    },
    shop: { name: 'Your Shop', url: 'https://shop.example/' },
    recipient: { email: 'alex@example.com', firstName: 'Alex' },
    unsubscribeUrl: 'https://shop.example/unsubscribe?t=abc',
    products: {
      [PRODUCT_ID]: {
        id: PRODUCT_ID,
        name: 'Ghost Pepper Sauce',
        url: 'https://shop.example/en/shop/ghost-pepper',
        priceCents: 899,
        compareAtPriceCents: 1099,
        currency: 'EUR',
        imageUrl: 'https://cdn.example/ghost.jpg',
        extras: ['Hot · 8/10']
      }
    },
    discounts: { SPRING15: { code: 'SPRING15', label: '15% off' } },
    now: new Date('2026-11-05T12:00:00Z'),
    ...overrides
  };
}
