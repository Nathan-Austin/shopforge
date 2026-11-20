import { describe, expect, it } from 'vitest';

import { buildStarterDocument } from '@/lib/email/campaigns/templates';
import { validateCampaignDocument } from '@/lib/email/campaigns/schema';
import { STARTER_KEYS, startersFor } from './mode';

/**
 * Every starter must be a valid document for any shop: one whose locales
 * the starters have text for, and one whose default language they don't.
 */
const SHOPS = [
  { locales: ['en', 'de', 'fr'], defaultLocale: 'en' },
  { locales: ['de', 'de-at', 'fr'], defaultLocale: 'de' },
  { locales: ['fr', 'nl'], defaultLocale: 'fr' }
];

const MODES = ['generic', 'chilli'] as const;

describe.each(MODES.flatMap((mode) => STARTER_KEYS.map((key) => [mode, key] as const)))(
  'the %s shop\'s %s starter',
  (mode, key) => {
    it.each(SHOPS)('validates for locales $locales', ({ locales, defaultLocale }) => {
      const result = validateCampaignDocument(
        buildStarterDocument(startersFor(mode)[key], locales, defaultLocale)
      );
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      expect(result.document.defaultLocale).toBe(defaultLocale);
      expect(result.document.subject[defaultLocale]).toBeTruthy();
    });
  }
);
