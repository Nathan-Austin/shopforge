import { describe, expect, it } from 'vitest';

import {
  CONFIRMATION_COOLDOWN_MS,
  cleanFirstName,
  isLocaleCode,
  normalizeEmail,
  planConfirm,
  planImport,
  planSubscribe
} from './rules';

const NOW = new Date('2026-11-05T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Sam@Example.COM ')).toBe('sam@example.com');
  });

  it.each(['', 'sam', 'sam@', '@example.com', 'sam example@x.com', null, 42, `${'a'.repeat(250)}@x.com`])('refuses %j', (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });
});

describe('cleanFirstName and isLocaleCode', () => {
  it('cleans names and caps their length', () => {
    expect(cleanFirstName('  Sam   Lee ')).toBe('Sam Lee');
    expect(cleanFirstName('   ')).toBeNull();
    expect(cleanFirstName('x'.repeat(150))).toHaveLength(100);
    expect(cleanFirstName(undefined)).toBeNull();
  });

  it('accepts shop locale codes only', () => {
    expect(isLocaleCode('de-at')).toBe(true);
    expect(isLocaleCode('DE')).toBe(false);
    expect(isLocaleCode('../en')).toBe(false);
  });
});

describe('planSubscribe', () => {
  it('creates a pending row for a new address', () => {
    expect(planSubscribe(null, NOW)).toEqual({ action: 'create' });
  });

  it('sends nothing to someone already subscribed', () => {
    expect(planSubscribe({ id: 'a', status: 'subscribed', confirmationSentAt: null }, NOW)).toEqual({
      action: 'none',
      reason: 'already-subscribed'
    });
  });

  it('resends a pending confirmation, but not within ten minutes', () => {
    const pending = (sentAgo: number | null) => ({ id: 'a', status: 'pending' as const, confirmationSentAt: sentAgo === null ? null : ago(sentAgo) });
    expect(planSubscribe(pending(CONFIRMATION_COOLDOWN_MS - 1), NOW)).toEqual({ action: 'none', reason: 'cooldown' });
    expect(planSubscribe(pending(CONFIRMATION_COOLDOWN_MS), NOW)).toEqual({ action: 'resend', id: 'a' });
    expect(planSubscribe(pending(null), NOW)).toEqual({ action: 'resend', id: 'a' });
  });

  it('lets someone who left come back by confirming again', () => {
    expect(planSubscribe({ id: 'a', status: 'unsubscribed', confirmationSentAt: ago(1000) }, NOW)).toEqual({ action: 'resubscribe', id: 'a' });
  });
});

describe('planConfirm', () => {
  it('confirms pending sign-ups only', () => {
    expect(planConfirm('pending')).toEqual({ action: 'confirm' });
    expect(planConfirm('subscribed')).toEqual({ action: 'none', reason: 'already-subscribed' });
    // An old confirmation link after unsubscribing does not resubscribe.
    expect(planConfirm('unsubscribed')).toEqual({ action: 'none', reason: 'unsubscribed' });
  });
});

describe('planImport', () => {
  it('adds new people and never overrides an existing row', () => {
    expect(planImport(null)).toEqual({ action: 'insert' });
    expect(planImport({ status: 'subscribed' })).toEqual({ action: 'skip', reason: 'exists' });
    expect(planImport({ status: 'pending' })).toEqual({ action: 'skip', reason: 'exists' });
    expect(planImport({ status: 'unsubscribed' })).toEqual({ action: 'skip', reason: 'unsubscribed' });
  });
});
