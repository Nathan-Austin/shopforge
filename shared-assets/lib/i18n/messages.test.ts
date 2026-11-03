import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * next-intl throws at render time when a message is missing, so a key that
 * exists in one language and not another is a crash in that language only.
 * These tests read the shop's own message files and hold every locale to the
 * same key set.
 */

const MESSAGES_DIR = path.join(process.cwd(), 'src/messages');

function loadLocale(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(MESSAGES_DIR, file), 'utf8'));
}

/** Every leaf key, flattened to dotted paths. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}

const files = readdirSync(MESSAGES_DIR).filter((file) => file.endsWith('.json'));
const locales = files.map((file) => file.replace(/\.json$/, ''));

/** Namespaces the shipped components ask for by name. */
const REQUIRED_NAMESPACES = [
  'Auth',
  'Nav',
  'Admin',
  'Shop',
  'Cart',
  'Checkout',
  'Account',
  'UI',
  'SauceArchive',
  'homepage'
];

describe('message files', () => {
  it('ships at least one locale', () => {
    expect(locales.length).toBeGreaterThan(0);
  });

  it.each(locales)('%s has every namespace the components use', (locale) => {
    const messages = loadLocale(`${locale}.json`);
    for (const namespace of REQUIRED_NAMESPACES) {
      expect(Object.keys(messages), `${locale} is missing "${namespace}"`).toContain(
        namespace
      );
    }
  });

  it('gives every locale the same keys', () => {
    const [reference, ...others] = locales;
    const expected = keyPaths(loadLocale(`${reference}.json`)).sort();

    for (const locale of others) {
      const actual = keyPaths(loadLocale(`${locale}.json`)).sort();
      const missing = expected.filter((key) => !actual.includes(key));
      const extra = actual.filter((key) => !expected.includes(key));

      expect(missing, `${locale} is missing keys from ${reference}`).toEqual([]);
      expect(extra, `${locale} has keys ${reference} does not`).toEqual([]);
    }
  });

  it.each(locales)('%s has no empty strings', (locale) => {
    const messages = loadLocale(`${locale}.json`);
    const empties: string[] = [];
    const walk = (value: unknown, prefix: string) => {
      if (typeof value === 'string') {
        if (value.trim() === '') empties.push(prefix);
        return;
      }
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          walk(child, prefix ? `${prefix}.${key}` : key);
        }
      }
    };
    walk(messages, '');
    expect(empties).toEqual([]);
  });
});
