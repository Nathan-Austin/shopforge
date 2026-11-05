/**
 * A campaign that uses every block type, for the unit tests. Not
 * imported by the app.
 */

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
