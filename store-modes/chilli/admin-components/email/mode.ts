/**
 * What the email builder does differently in a chilli shop: product blocks
 * show heat and Scoville under the name, and the starters talk heat.
 */

import type { CampaignModeHooks } from '@/lib/email/campaigns/server';
import type { StarterDefinition } from '@/lib/email/campaigns/templates';
import { formatHeatOn } from '@/lib/products/heat';

export const CAMPAIGN_MODE: CampaignModeHooks = {
  productColumns: ', heat_level, scoville_shu',
  productExtras: (row, { heatScale }) => {
    const lines: string[] = [];
    const heat = formatHeatOn(heatScale, row.heat_level as number | null);
    if (heat) lines.push(`🌶 ${heat}`);
    if (typeof row.scoville_shu === 'number' && row.scoville_shu > 0) {
      lines.push(`${row.scoville_shu.toLocaleString('en')} SHU`);
    }
    return lines;
  }
};

export const STARTERS = {
  blank: {
    subject: { en: 'News from {{shop.name}}', de: 'Neues von {{shop.name}}' },
    brandColor: '#b91c1c',
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
    subject: {
      en: 'This month’s heat at {{shop.name}}',
      de: 'Die Schärfe des Monats bei {{shop.name}}'
    },
    preheader: {
      en: 'New sauces, old favourites and what to try next',
      de: 'Neue Saucen, alte Favoriten und was Sie als Nächstes probieren sollten'
    },
    brandColor: '#b91c1c',
    blocks: [
      {
        type: 'heading',
        text: { en: 'This month’s heat', de: 'Die Schärfe des Monats' }
      },
      {
        type: 'text',
        paragraphs: [
          {
            en: 'Hi {{subscriber.first_name|chilli lover}},',
            de: 'Hallo {{subscriber.first_name|Chili-Fan}},'
          },
          {
            en: 'Fresh batches are in. Tell your subscribers what is new, from mild to wild, and replace this text with your own.',
            de: 'Frische Chargen sind da. Erzählen Sie, was neu ist, von mild bis feurig, und ersetzen Sie diesen Text durch Ihren eigenen.'
          }
        ]
      },
      {
        type: 'button',
        label: { en: 'Shop the sauces', de: 'Zu den Saucen' },
        href: '{{shop.locale_url}}/shop'
      },
      { type: 'divider' },
      {
        type: 'text',
        paragraphs: [
          {
            en: 'Stay hot. Thank you for shopping with us.',
            de: 'Bleiben Sie scharf. Vielen Dank für Ihren Einkauf.'
          }
        ]
      }
    ]
  }
} satisfies Record<string, StarterDefinition>;

export type StarterKey = keyof typeof STARTERS;
export const STARTER_KEYS = Object.keys(STARTERS) as StarterKey[];
