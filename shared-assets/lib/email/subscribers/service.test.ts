import { createTranslator } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signSubscriberToken } from './tokens';

vi.mock('server-only', () => ({}));

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    createTranslator({
      locale,
      namespace: namespace as never,
      messages: {
        Email: {
          subscribe: {
            subject: '{shop}: please confirm',
            headline: 'One more step',
            intro: 'Confirm news from {shop}.',
            button: 'Confirm',
            expires: 'Works for 7 days.',
            ignore: 'Not you? Ignore this.'
          }
        }
      } as never
    })
}));

const sendEmail = vi.fn();
vi.mock('@/lib/email/send', () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));

type Row = Record<string, unknown>;

/**
 * Just enough of the Supabase query builder over in-memory tables for the
 * calls the service makes, unique email included.
 */
class FakeDatabase {
  tables: Record<string, Row[]> = { email_subscribers: [], email_subscriber_events: [] };
  private nextId = 1;
  /** Makes the next insert into email_subscribers lose a race, once. */
  raceOnce: Row | null = null;

  from(table: string) {
    return new Query(this, table);
  }

  id(): string {
    return `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
  }
}

class Query {
  private filters: ((row: Row) => boolean)[] = [];
  private op: { kind: 'select' } | { kind: 'insert'; rows: Row[]; upsert?: boolean } | { kind: 'update'; patch: Row } | { kind: 'delete' } = { kind: 'select' };
  private shape: 'many' | 'single' | 'maybe' = 'many';

  constructor(private db: FakeDatabase, private table: string) {}

  select() {
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }
  upsert(rows: Row[]) {
    this.op = { kind: 'insert', rows, upsert: true };
    return this;
  }
  update(patch: Row) {
    this.op = { kind: 'update', patch };
    return this;
  }
  delete() {
    this.op = { kind: 'delete' };
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  single() {
    this.shape = 'single';
    return this;
  }
  maybeSingle() {
    this.shape = 'maybe';
    return this;
  }
  then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }

  private run(): { data: unknown; error: { code?: string; message: string } | null } {
    const table = this.db.tables[this.table];
    const matching = () => table.filter((row) => this.filters.every((filter) => filter(row)));
    let result: Row[];
    switch (this.op.kind) {
      case 'select':
        result = matching();
        break;
      case 'insert': {
        result = [];
        for (const input of this.op.rows) {
          if (this.table === 'email_subscribers') {
            if (this.db.raceOnce && !this.op.upsert) {
              table.push(this.db.raceOnce);
              this.db.raceOnce = null;
            }
            if (table.some((row) => row.email === input.email)) {
              if (this.op.upsert) continue;
              return { data: null, error: { code: '23505', message: 'duplicate key' } };
            }
          }
          const row = { id: this.db.id(), status: 'pending', consented_at: new Date().toISOString(), confirmation_sent_at: null, confirmed_at: null, unsubscribed_at: null, ...input };
          table.push(row);
          result.push(row);
        }
        break;
      }
      case 'update': {
        result = matching();
        for (const row of result) Object.assign(row, (this.op as { patch: Row }).patch);
        break;
      }
      case 'delete': {
        result = matching();
        this.db.tables[this.table] = table.filter((row) => !result.includes(row));
        if (this.table === 'email_subscribers') {
          const gone = new Set(result.map((row) => row.id));
          this.db.tables.email_subscriber_events = this.db.tables.email_subscriber_events.filter((event) => !gone.has(event.subscriber_id));
        }
        break;
      }
    }
    if (this.shape === 'many') return { data: result, error: null };
    if (this.shape === 'single' && result.length !== 1) return { data: null, error: { message: 'not one row' } };
    return { data: result[0] ?? null, error: null };
  }
}

let db: FakeDatabase;
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));

const service = await import('./service');
const SECRET = 's'.repeat(40);
const env = { ...process.env };

beforeEach(() => {
  db = new FakeDatabase();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ sent: true, id: 'm1' });
  process.env.RESEND_API_KEY = 're_test';
  process.env.EMAIL_FROM = 'Shop <shop@example.com>';
  process.env.EMAIL_SIGNING_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SITE_URL = 'https://shop.example';
  process.env.NEXT_PUBLIC_SHOP_NAME = 'Test Shop';
});
afterEach(() => {
  process.env = { ...env };
});

const subscribers = () => db.tables.email_subscribers;
const events = () => db.tables.email_subscriber_events.map((event) => event.event);
const signUp = (email = 'Sam@Example.com', extra: Partial<Parameters<typeof service.requestSubscription>[0]> = {}) =>
  service.requestSubscription({ email, firstName: ' Sam ', locale: 'de', source: 'footer', consentText: 'Send me news.', ...extra });

describe('requestSubscription', () => {
  it('adds a pending subscriber with their consent and sends one confirmation', async () => {
    expect(await signUp()).toEqual({ ok: true });
    expect(subscribers()).toEqual([
      expect.objectContaining({ email: 'sam@example.com', first_name: 'Sam', locale: 'de', status: 'pending', source: 'footer', consent_text: 'Send me news.' })
    ]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = sendEmail.mock.calls[0][0];
    expect(message.to).toBe('sam@example.com');
    expect(message.subject).toBe('Test Shop: please confirm');
    expect(message.html).toMatch(/href="https:\/\/shop\.example\/de\/newsletter\/confirm\?t=v1\./);
    expect(subscribers()[0].confirmation_sent_at).toEqual(expect.any(String));
    expect(events()).toEqual(['requested', 'confirmation_sent']);
  });

  it('answers the same for an address already on the list, and sends nothing', async () => {
    await signUp();
    subscribers()[0].status = 'subscribed';
    sendEmail.mockClear();
    expect(await signUp('sam@example.com')).toEqual({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not resend within ten minutes', async () => {
    await signUp();
    sendEmail.mockClear();
    expect(await signUp()).toEqual({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
    subscribers()[0].confirmation_sent_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    await signUp();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('takes someone who left back to pending with the new consent', async () => {
    await signUp();
    Object.assign(subscribers()[0], { status: 'unsubscribed', unsubscribed_at: '2026-01-01T00:00:00Z' });
    await signUp('sam@example.com', { source: 'checkout', consentText: 'Yes at checkout.', locale: 'en' });
    expect(subscribers()[0]).toMatchObject({ status: 'pending', source: 'checkout', consent_text: 'Yes at checkout.', locale: 'en', unsubscribed_at: '2026-01-01T00:00:00Z' });
    expect(events()).toContain('resubscribe_requested');
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('copes with two sign-ups for one address at once', async () => {
    db.raceOnce = { id: db.id(), email: 'sam@example.com', status: 'subscribed', confirmation_sent_at: null };
    expect(await signUp()).toEqual({ ok: true });
    expect(subscribers()).toHaveLength(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a bad address and does nothing when the newsletter is off', async () => {
    expect(await signUp('nope')).toEqual({ ok: false, reason: 'invalid-email' });
    delete process.env.EMAIL_SIGNING_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    expect(await signUp()).toEqual({ ok: false, reason: 'unavailable' });
    expect(subscribers()).toEqual([]);
  });

  it('keeps the subscriber when the confirmation email fails, so it can be resent', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'failed', error: 'Resend 500' });
    expect(await signUp()).toEqual({ ok: true });
    expect(subscribers()[0]).toMatchObject({ status: 'pending', confirmation_sent_at: null });
    expect(events()).toEqual(['requested']);
  });
});

describe('confirm and unsubscribe', () => {
  async function pending() {
    await signUp();
    return subscribers()[0].id as string;
  }

  it('confirms once, however often the button is pressed', async () => {
    const id = await pending();
    const token = signSubscriberToken(id, 'confirm', SECRET);
    expect(await service.confirmSubscription(token)).toBe('confirmed');
    expect(await service.confirmSubscription(token)).toBe('already-subscribed');
    expect(subscribers()[0]).toMatchObject({ status: 'subscribed', confirmed_at: expect.any(String) });
    expect(events().filter((event) => event === 'confirmed')).toHaveLength(1);
  });

  it('does not let an old confirmation link undo an unsubscribe', async () => {
    const id = await pending();
    const confirm = signSubscriberToken(id, 'confirm', SECRET);
    await service.confirmSubscription(confirm);
    expect(await service.unsubscribeByToken(signSubscriberToken(id, 'unsubscribe', SECRET), 'page')).toBe('unsubscribed');
    expect(await service.confirmSubscription(confirm)).toBe('unsubscribed');
    expect(subscribers()[0].status).toBe('unsubscribed');
  });

  it('retires an older confirm link once the person signs up again', async () => {
    const id = await pending();
    const old = signSubscriberToken(id, 'confirm', SECRET, new Date(Date.now() - 60 * 60 * 1000));
    // They unsubscribed, then signed up again just now: a new consent.
    Object.assign(subscribers()[0], { status: 'unsubscribed', unsubscribed_at: new Date().toISOString() });
    await signUp();
    expect(await service.confirmSubscription(old)).toBe('expired');
    expect(subscribers()[0].status).toBe('pending');
    expect(await service.confirmSubscription(signSubscriberToken(id, 'confirm', SECRET))).toBe('confirmed');
  });

  it('unsubscribes idempotently and records how', async () => {
    const id = await pending();
    const token = signSubscriberToken(id, 'unsubscribe', SECRET);
    expect(await service.unsubscribeByToken(token, 'one-click')).toBe('unsubscribed');
    expect(await service.unsubscribeByToken(token, 'page')).toBe('unsubscribed');
    expect(db.tables.email_subscriber_events.filter((event) => event.event === 'unsubscribed')).toEqual([
      expect.objectContaining({ source: 'one-click' })
    ]);
  });

  it('refuses tokens that are forged, for the wrong job, or for someone deleted', async () => {
    const id = await pending();
    expect(await service.unsubscribeByToken(signSubscriberToken(id, 'unsubscribe', 'x'.repeat(40)), 'page')).toBe('invalid');
    expect(await service.unsubscribeByToken(signSubscriberToken(id, 'confirm', SECRET), 'page')).toBe('invalid');
    expect(await service.ownerDelete(id)).toBe(true);
    expect(await service.confirmSubscription(signSubscriberToken(id, 'confirm', SECRET))).toBe('invalid');
    expect(db.tables.email_subscriber_events).toEqual([]);
  });

  it('reads a link without changing anything', async () => {
    const id = await pending();
    expect(await service.readSubscriberLink(signSubscriberToken(id, 'unsubscribe', SECRET), 'unsubscribe')).toEqual({
      valid: true,
      subscriberId: id,
      email: 'sam@example.com',
      status: 'pending',
      locale: 'de'
    });
    expect(subscribers()[0].status).toBe('pending');
  });
});

describe('owner actions', () => {
  it('resends only to pending subscribers', async () => {
    await signUp();
    const id = subscribers()[0].id as string;
    expect(await service.ownerResendConfirmation(id)).toBe('sent');
    subscribers()[0].status = 'subscribed';
    expect(await service.ownerResendConfirmation(id)).toBe('not-pending');
  });

  it('imports new people as subscribed, skipping existing and unsubscribed ones', async () => {
    await signUp('kept@example.com');
    await signUp('left@example.com');
    Object.assign(subscribers()[1], { status: 'unsubscribed', unsubscribed_at: '2026-01-01T00:00:00Z' });
    const outcome = await service.importSubscribers(
      [
        { email: 'new@example.com', firstName: 'Neu', locale: 'de' },
        { email: 'kept@example.com', firstName: 'Changed', locale: 'en' },
        { email: 'left@example.com', firstName: null, locale: 'en' }
      ],
      'The owner confirmed these people agreed.'
    );
    expect(outcome).toEqual({ added: 1, skippedExisting: 1, skippedUnsubscribed: 1 });
    expect(subscribers().find((row) => row.email === 'new@example.com')).toMatchObject({ status: 'subscribed', source: 'import', consent_text: 'The owner confirmed these people agreed.' });
    expect(subscribers().find((row) => row.email === 'kept@example.com')).toMatchObject({ first_name: 'Sam' });
    expect(subscribers().find((row) => row.email === 'left@example.com')).toMatchObject({ status: 'unsubscribed' });
    expect(events()).toContain('imported');
  });
});
