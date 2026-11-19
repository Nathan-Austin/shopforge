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
    subject: { en: 'News from {{shop.name}}', de: 'Neues von {{shop.name}}' },
    blocks: [
      {
        type: 'text',
        paragraphs: [
          {
            en: 'Write your message here.',
            de: 'Schreiben Sie hier Ihre Nachricht.'
          }
        ]
      }
    ]
  },
  newsletter: {
    subject: { en: 'News from {{shop.name}}', de: 'Neues von {{shop.name}}' },
    preheader: {
      en: 'What is new this month',
      de: 'Das ist neu in diesem Monat'
    },
    blocks: [
      { type: 'heading', text: { en: 'News from {{shop.name}}', de: 'Neues von {{shop.name}}' } },
      {
        type: 'text',
        paragraphs: [
          {
            en: 'Hi {{subscriber.first_name|there}},',
            de: 'Hallo {{subscriber.first_name|zusammen}},'
          },
          {
            en: 'Here is what is new in the shop this month. Replace this text with your own news.',
            de: 'Das ist neu im Shop in diesem Monat. Ersetzen Sie diesen Text durch Ihre eigenen Neuigkeiten.'
          }
        ]
      },
      {
        type: 'button',
        label: { en: 'Visit the shop', de: 'Zum Shop' },
        href: '{{shop.locale_url}}/shop'
      },
      { type: 'divider' },
      {
        type: 'text',
        paragraphs: [
          {
            en: 'Thank you for shopping with us.',
            de: 'Vielen Dank für Ihren Einkauf bei uns.'
          }
        ]
      }
    ]
  }
} satisfies Record<string, StarterDefinition>;

export type StarterKey = keyof typeof STARTERS;
export const STARTER_KEYS = Object.keys(STARTERS) as StarterKey[];
