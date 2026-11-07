import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResendClient } from '../providers/resend';
import { FakeDatabase, type Row } from '../testDatabase';

vi.mock('server-only', () => ({}));
const { countDue, ensureAudience, pullUnsubscribes, pushDue, syncAudienceStep } = await import('./sync');

/** A Resend that records calls and answers from a script. */
function fakeResend(overrides: Partial<Record<keyof ResendClient, unknown>> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  let nextContact = 1;
  const record = <T,>(method: string, answer: (...args: unknown[]) => T) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve(answer(...args));
    });
  const client = {
    name: 'resend' as const,
    listAudiences: record('listAudiences', () => ({ ok: true, data: [] })),
    createAudience: record('createAudience', () => ({ ok: true, data: { id: 'aud_new' } })),
    createContact: record('createContact', () => ({ ok: true, data: { id: `c_${nextContact++}` } })),
    updateContact: record('updateContact', (_a, id) => ({ ok: true, data: { id } })),
    deleteContact: record('deleteContact', () => ({ ok: true, data: { deleted: true } })),
    listContacts: record('listContacts', () => ({ ok: true, data: [] })),
    createBroadcast: record('createBroadcast', () => ({ ok: true, data: { id: 'b_1' } })),
    sendBroadcast: record('sendBroadcast', () => ({ ok: true, data: { id: 'b_1' } })),
    getBroadcast: record('getBroadcast', () => ({ ok: true, data: { id: 'b_1', status: 'sent', scheduled_at: null, sent_at: null } })),
    ...overrides
  } as unknown as ResendClient;
  return { client, calls };
}

let db: FakeDatabase;
const subscriber = (email: string, extra: Row = {}): Row => {
  const row = { id: db.id(), email, first_name: null, locale: 'de', status: 'subscribed', source: 'footer', consent_text: 'x', updated_at: '2026-11-01T00:00:00.000Z', provider_contact_id: null, provider_locale: null, provider_synced_at: null, ...extra };
  db.tables.email_subscribers.push(row);
  return row;
};
const audience = { locale: 'de', provider: 'resend', audience_id: 'aud_de', pulled_at: null };
const fast = { budgetMs: 10_000, sleep: async () => undefined };

beforeEach(() => {
  db = new FakeDatabase();
});

describe('ensureAudience', () => {
  it('reuses a recorded audience, then one with the shop\'s name at the provider, else creates one', async () => {
    const { client, calls } = fakeResend({ listAudiences: vi.fn(async () => ({ ok: true, data: [{ id: 'aud_old', name: 'Shop (de)' }] })) });
    expect(await ensureAudience(db as never, client, 'de', 'Shop')).toMatchObject({ ok: true, audience: { audience_id: 'aud_old' } });
    expect(db.tables.email_audiences).toEqual([expect.objectContaining({ locale: 'de', audience_id: 'aud_old' })]);
    expect(await ensureAudience(db as never, client, 'de', 'Shop')).toMatchObject({ ok: true, audience: { audience_id: 'aud_old' } });
    expect(await ensureAudience(db as never, client, 'en', 'Shop')).toMatchObject({ ok: true, audience: { audience_id: 'aud_new' } });
    expect(calls.filter((call) => call.method === 'createAudience')).toEqual([{ method: 'createAudience', args: ['Shop (en)'] }]);
  });
});

describe('pullUnsubscribes', () => {
  it('unsubscribes people the provider says left, once, with the provider in their history', async () => {
    const left = subscriber('left@example.com');
    subscriber('stay@example.com');
    const gone = subscriber('gone@example.com', { status: 'unsubscribed' });
    db.tables.email_audiences.push({ ...audience });
    const { client } = fakeResend({
      listContacts: vi.fn(async () => ({ ok: true, data: [{ id: 'c1', email: 'Left@example.com', first_name: null, unsubscribed: true }, { id: 'c2', email: 'stay@example.com', first_name: null, unsubscribed: false }, { id: 'c3', email: 'gone@example.com', first_name: null, unsubscribed: true }] }))
    });
    const now = new Date('2026-11-05T12:00:00Z');
    expect(await pullUnsubscribes(db as never, client, audience, now)).toEqual({ count: 1, error: null });
    expect(left.status).toBe('unsubscribed');
    expect(gone.unsubscribed_at).toBeUndefined();
    expect(db.tables.email_subscriber_events).toEqual([expect.objectContaining({ subscriber_id: left.id, event: 'unsubscribed', source: 'provider' })]);
    expect(db.tables.email_audiences[0].pulled_at).toBe(now.toISOString());
  });
});

describe('pushDue', () => {
  it('creates new contacts, updates known ones, and leaves pending people alone', async () => {
    const fresh = subscriber('new@example.com', { first_name: 'Neu' });
    const known = subscriber('known@example.com', { provider_contact_id: 'c_k', provider_locale: 'de', provider_synced_at: '2026-10-01T00:00:00.000Z', first_name: 'K' });
    subscriber('pending@example.com', { status: 'pending' });
    const synced = subscriber('synced@example.com', { provider_contact_id: 'c_s', provider_locale: 'de', provider_synced_at: '2026-11-02T00:00:00.000Z' });
    const { client, calls } = fakeResend();
    expect(await pushDue(db as never, client, audience, fast)).toEqual({ pushed: 2, rateLimited: false, error: null });
    expect(calls.map((call) => call.method)).toEqual(['createContact', 'updateContact']);
    expect(calls[0].args).toEqual(['aud_de', { email: 'new@example.com', firstName: 'Neu', unsubscribed: false }]);
    expect(calls[1].args).toEqual(['aud_de', 'c_k', { firstName: 'K', unsubscribed: false }]);
    expect(fresh).toMatchObject({ provider_contact_id: 'c_1', provider_locale: 'de' });
    expect(FakeDatabase.syncDue(fresh)).toBe(false);
    expect(FakeDatabase.syncDue(known)).toBe(false);
    expect(FakeDatabase.syncDue(synced)).toBe(false);
    expect(await countDue(db as never, 'de')).toBe(0);
  });

  it('tells the provider about an unsubscribe only if it ever had the person', async () => {
    subscriber('had@example.com', { status: 'unsubscribed', provider_contact_id: 'c_h', provider_locale: 'de', provider_synced_at: '2026-10-01T00:00:00.000Z' });
    subscriber('never@example.com', { status: 'unsubscribed' });
    const { client, calls } = fakeResend();
    expect(await pushDue(db as never, client, audience, fast)).toMatchObject({ pushed: 2 });
    expect(calls).toEqual([{ method: 'updateContact', args: ['aud_de', 'c_h', { firstName: null, unsubscribed: true }] }]);
  });

  it('moves someone who changed language out of the old audience and into the new', async () => {
    db.tables.email_audiences.push({ locale: 'en', provider: 'resend', audience_id: 'aud_en', pulled_at: null }, { ...audience });
    const moved = subscriber('moved@example.com', { provider_contact_id: 'c_m', provider_locale: 'en', provider_synced_at: '2026-10-01T00:00:00.000Z' });
    const { client, calls } = fakeResend();
    await pushDue(db as never, client, audience, fast);
    expect(calls.map((call) => [call.method, call.args[0]])).toEqual([['deleteContact', 'aud_en'], ['createContact', 'aud_de']]);
    expect(moved).toMatchObject({ provider_contact_id: 'c_1', provider_locale: 'de' });
  });

  it('stops at a rate limit and at the time budget, leaving the rest due', async () => {
    for (let i = 0; i < 5; i++) subscriber(`p${i}@example.com`);
    let answers = 0;
    const { client } = fakeResend({ createContact: vi.fn(async () => (++answers <= 2 ? { ok: true, data: { id: `c_${answers}` } } : { ok: false, status: 429, message: 'slow down', rateLimited: true })) });
    expect(await pushDue(db as never, client, audience, fast)).toEqual({ pushed: 2, rateLimited: true, error: null });
    expect(await countDue(db as never, 'de')).toBe(3);
    let tick = 0;
    const { client: slow } = fakeResend();
    expect(await pushDue(db as never, slow, audience, { ...fast, budgetMs: 100, now: () => (tick += 60) })).toEqual({ pushed: 1, rateLimited: false, error: null });
  });

  it('recovers a contact the provider already has, and recreates one it lost', async () => {
    const dup = subscriber('dup@example.com');
    const lost = subscriber('lost@example.com', { provider_contact_id: 'c_lost', provider_locale: 'de', provider_synced_at: '2026-10-01T00:00:00.000Z' });
    const { client } = fakeResend({
      createContact: vi.fn(async (_a: string, c: { email: string }) => (c.email === 'dup@example.com' ? { ok: false, status: 409, message: 'Contact already exists', rateLimited: false } : { ok: true, data: { id: 'c_again' } })),
      updateContact: vi.fn(async (_a: string, id: string) => (id === 'c_lost' ? { ok: false, status: 404, message: 'not found', rateLimited: false } : { ok: true, data: { id: 'c_dup' } }))
    });
    expect(await pushDue(db as never, client, audience, fast)).toEqual({ pushed: 2, rateLimited: false, error: null });
    expect(dup.provider_contact_id).toBe('c_dup');
    expect(lost.provider_contact_id).toBe('c_again');
  });

  it('reports any other refusal with the address', async () => {
    subscriber('bad@example.com');
    const { client } = fakeResend({ createContact: vi.fn(async () => ({ ok: false, status: 422, message: 'Invalid email', rateLimited: false })) });
    expect(await pushDue(db as never, client, audience, fast)).toEqual({ pushed: 0, rateLimited: false, error: 'bad@example.com: Invalid email' });
  });
});

describe('syncAudienceStep', () => {
  it('creates the audience, pulls once in a while, pushes, and counts what is left', async () => {
    subscriber('a@example.com');
    const { client, calls } = fakeResend();
    const first = await syncAudienceStep(db as never, client, 'de', 'Shop', { budgetMs: 10_000 });
    expect(first).toEqual({ locale: 'de', audienceId: 'aud_new', pushed: 1, remaining: 0, pulledUnsubscribes: 0, rateLimited: false, error: null });
    expect(calls.map((call) => call.method)).toEqual(['listAudiences', 'createAudience', 'listContacts', 'createContact']);
    const second = await syncAudienceStep(db as never, client, 'de', 'Shop', { budgetMs: 10_000 });
    expect(second.pushed).toBe(0);
    // Pulled a moment ago: not again.
    expect(calls.filter((call) => call.method === 'listContacts')).toHaveLength(1);
  });
});
