/**
 * What the email builder does differently in a generic shop: product
 * blocks show name and price only, and the starters are general purpose.
 * The chilli mode's copy of this file adds heat.
 */

import type { CampaignModeHooks } from '@/lib/email/campaigns/server';
import type { StarterDefinition } from '@/lib/email/campaigns/templates';

export const CAMPAIGN_MODE: CampaignModeHooks = {
  productColumns: '',
  productExtras: () => []
};

export const STARTERS = {
  blank: {
    subject: { en: 'News from {{shop.name}}', de: 'Neues von {{shop.name}}', tr: '{{shop.name}} haberleri', ar: 'أخبار {{shop.name}}' },
    blocks: [
      {
        type: 'text',
        paragraphs: [
          {
            en: 'Write your message here.',
            de: 'Schreiben Sie hier Ihre Nachricht.',
            tr: 'Mesajınızı buraya yazın.',
            ar: 'اكتب رسالتك هنا.'
          }
        ]
      }
    ]
  },
  newsletter: {
    subject: { en: 'News from {{shop.name}}', de: 'Neues von {{shop.name}}', tr: '{{shop.name}} haberleri', ar: 'أخبار {{shop.name}}' },
    preheader: {
      en: 'What is new this month',
      de: 'Das ist neu in diesem Monat',
      tr: 'Bu ay neler yeni',
      ar: 'ما الجديد هذا الشهر'
    },
    blocks: [
      { type: 'heading', text: { en: 'News from {{shop.name}}', de: 'Neues von {{shop.name}}', tr: '{{shop.name}} haberleri', ar: 'أخبار {{shop.name}}' } },
      {
        type: 'text',
        paragraphs: [
          {
            en: 'Hi {{subscriber.first_name|there}},',
            de: 'Hallo {{subscriber.first_name|zusammen}},',
            tr: 'Merhaba {{subscriber.first_name|değerli müşterimiz}},',
            ar: 'مرحبًا {{subscriber.first_name|عزيزي العميل}}،'
          },
          {
            en: 'Here is what is new in the shop this month. Replace this text with your own news.',
            de: 'Das ist neu im Shop in diesem Monat. Ersetzen Sie diesen Text durch Ihre eigenen Neuigkeiten.',
            tr: 'Bu ay mağazada neler yeni. Bu metni kendi haberlerinizle değiştirin.',
            ar: 'إليك الجديد في المتجر هذا الشهر. استبدل هذا النص بأخبارك.'
          }
        ]
      },
      {
        type: 'button',
        label: { en: 'Visit the shop', de: 'Zum Shop', tr: 'Mağazayı ziyaret edin', ar: 'زيارة المتجر' },
        href: '{{shop.locale_url}}/shop'
      },
      { type: 'divider' },
      {
        type: 'text',
        paragraphs: [
          {
            en: 'Thank you for shopping with us.',
            de: 'Vielen Dank für Ihren Einkauf bei uns.',
            tr: 'Bizden alışveriş yaptığınız için teşekkürler.',
            ar: 'شكرًا لتسوقك معنا.'
          }
        ]
      }
    ]
  }
} satisfies Record<string, StarterDefinition>;

export type StarterKey = keyof typeof STARTERS;
export const STARTER_KEYS = Object.keys(STARTERS) as StarterKey[];
