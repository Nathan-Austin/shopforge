import { describe, expect, it } from 'vitest';

import { buildStarterDocument } from '@/lib/email/campaigns/templates';
import { validateCampaignDocument } from '@/lib/email/campaigns/schema';
import { STARTER_KEYS, STARTERS } from './mode';

/**
 * Every starter must be a valid document for any shop: one whose locales
 * the starters have text for, and one whose default language they don't.
 */
const SHOPS = [
  { locales: ['en', 'de', 'ar'], defaultLocale: 'en' },
  { locales: ['de', 'de-at', 'tr'], defaultLocale: 'de' },
  { locales: ['fr', 'nl'], defaultLocale: 'fr' }
];

describe.each(STARTER_KEYS)('the %s starter', (key) => {
  it.each(SHOPS)('validates for locales $locales', ({ locales, defaultLocale }) => {
    const result = validateCampaignDocument(buildStarterDocument(STARTERS[key], locales, defaultLocale));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.document.defaultLocale).toBe(defaultLocale);
    expect(result.document.subject[defaultLocale]).toBeTruthy();
  });
});
