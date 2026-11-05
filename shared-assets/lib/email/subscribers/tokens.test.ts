import { describe, expect, it } from 'vitest';

import { CONFIRM_TTL_SECONDS, signSubscriberToken, signingSecret, verifySubscriberToken } from './tokens';

const SECRET = 'x'.repeat(40);
const ID = '0b6f6c1e-8a8e-4d71-9a51-3f3d6f7f2a10';
const NOW = new Date('2026-11-05T12:00:00Z');

describe('signingSecret', () => {
  it('prefers EMAIL_SIGNING_SECRET, falls back to NEXTAUTH_SECRET', () => {
    expect(signingSecret({ EMAIL_SIGNING_SECRET: SECRET, NEXTAUTH_SECRET: 'y'.repeat(40) })).toBe(SECRET);
    expect(signingSecret({ NEXTAUTH_SECRET: 'y'.repeat(40) })).toBe('y'.repeat(40));
  });

  it('refuses a missing or short secret', () => {
    expect(signingSecret({})).toBeNull();
    expect(signingSecret({ EMAIL_SIGNING_SECRET: 'short' })).toBeNull();
  });
});

describe('subscriber tokens', () => {
  it('round-trips both purposes, confirm links with their issue time', () => {
    expect(verifySubscriberToken(signSubscriberToken(ID, 'unsubscribe', SECRET, NOW), 'unsubscribe', SECRET, NOW)).toEqual({ ok: true, subscriberId: ID });
    expect(verifySubscriberToken(signSubscriberToken(ID, 'confirm', SECRET, NOW), 'confirm', SECRET, NOW)).toEqual({
      ok: true,
      subscriberId: ID,
      issuedAt: NOW.getTime()
    });
  });

  it('is URL-safe as it is', () => {
    expect(signSubscriberToken(ID, 'confirm', SECRET, NOW)).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('does not let one kind of link do the other\'s job', () => {
    const confirm = signSubscriberToken(ID, 'confirm', SECRET, NOW);
    expect(verifySubscriberToken(confirm, 'unsubscribe', SECRET, NOW)).toEqual({ ok: false, reason: 'purpose' });
  });

  it('refuses another shop\'s signature and any tampering', () => {
    const token = signSubscriberToken(ID, 'unsubscribe', SECRET, NOW);
    expect(verifySubscriberToken(token, 'unsubscribe', 'z'.repeat(40), NOW)).toEqual({ ok: false, reason: 'signature' });
    const [version, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ s: '11111111-1111-4111-8111-111111111111', p: 'unsubscribe' })).toString('base64url');
    expect(verifySubscriberToken(`${version}.${forged}.${signature}`, 'unsubscribe', SECRET, NOW)).toEqual({ ok: false, reason: 'signature' });
    expect(verifySubscriberToken(`${token.slice(0, -2)}AA`, 'unsubscribe', SECRET, NOW)).toEqual({ ok: false, reason: 'signature' });
  });

  it('lets confirmation links expire after a week, unsubscribe links never', () => {
    const confirm = signSubscriberToken(ID, 'confirm', SECRET, NOW);
    const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
    expect(verifySubscriberToken(confirm, 'confirm', SECRET, later(CONFIRM_TTL_SECONDS)).ok).toBe(true);
    expect(verifySubscriberToken(confirm, 'confirm', SECRET, later(CONFIRM_TTL_SECONDS + 1))).toEqual({ ok: false, reason: 'expired' });
    const unsubscribe = signSubscriberToken(ID, 'unsubscribe', SECRET, NOW);
    expect(verifySubscriberToken(unsubscribe, 'unsubscribe', SECRET, later(5 * 365 * 24 * 3600)).ok).toBe(true);
  });

  it.each([undefined, null, 42, '', 'v1', 'v1.a', 'v2.a.b', 'v1.a.b.c', 'x'.repeat(600)])('calls %j malformed', (token) => {
    expect(verifySubscriberToken(token, 'unsubscribe', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a correctly signed payload that is not a subscriber id', () => {
    const token = signSubscriberToken('not-a-uuid', 'unsubscribe', SECRET, NOW);
    expect(verifySubscriberToken(token, 'unsubscribe', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });
});
