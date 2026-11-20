/**
 * What the email builder does per store mode: what a product block shows
 * under the name, and which starter templates the owner can pick from.
 *
 * One file for every shop since 2026-11-20. The product columns are read
 * everywhere — every shop has carried them since 0014 — and the heat
 * lines appear only where there is a scale to format them against, which
 * is to say in a chilli shop. The starters differ in their words, so both
 * sets live here and the mode picks one.
 */

import type { CampaignModeHooks } from '@/lib/email/campaigns/server';
import type { StarterDefinition } from '@/lib/email/campaigns/templates';
import type { StoreMode } from '@/lib/products/catalogue';
import { formatHeatOn } from '@/lib/products/heat';

export const CAMPAIGN_MODE: CampaignModeHooks = {
  productColumns: ', heat_level, scoville_shu',
  productExtras: (row, { heatScale }) => {
    // No scale, no chilli mode: a product block is name and price.
    if (!heatScale) return [];
    const lines: string[] = [];
    const heat = formatHeatOn(heatScale, row.heat_level as number | null);
    if (heat) lines.push(`🌶 ${heat}`);
    if (typeof row.scoville_shu === 'number' && row.scoville_shu > 0) {
      lines.push(`${row.scoville_shu.toLocaleString('en')} SHU`);
    }
    return lines;
  }
};

/** General-purpose starters. */
const GENERIC_STARTERS = {
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

/** The same starters, talking heat. */
const CHILLI_STARTERS = {
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

/** Both sets offer the same starters; only their words differ. */
export type StarterKey = keyof typeof GENERIC_STARTERS;
export const STARTER_KEYS = Object.keys(GENERIC_STARTERS) as StarterKey[];

export function startersFor(mode: StoreMode): Record<StarterKey, StarterDefinition> {
  return mode === 'chilli' ? CHILLI_STARTERS : GENERIC_STARTERS;
}
