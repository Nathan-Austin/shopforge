import { createTranslator } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResendClient } from '../providers/resend';
import { FakeDatabase, type Row } from '../testDatabase';
import { sampleDocument } from './fixtures';

vi.mock('server-only', () => ({}));
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    createTranslator({
      locale,
      namespace: namespace as never,
      messages: {
        Email: {
          campaign: {
            footerReason: 'You subscribed to {shop}.', unsubscribe: 'Unsubscribe', viewProduct: 'View product', discountTitle: 'Your code', discountHint: 'At checkout.',
            discountPercent: '{percent}% off', discountAmount: '{amount} off', discountFreeShipping: 'Free shipping'
          }
        }
      } as never
    })
}));

const resendCalls: { method: string; args: unknown[] }[] = [];
let resendAnswers: Partial<Record<keyof ResendClient, (...args: unknown[]) => unknown>> = {};
vi.mock('../providers/resend', async (importOriginal) => {
  const original = await importOriginal<typeof import('../providers/resend')>();
  const methods: (keyof ResendClient)[] = ['verifyKey', 'createBroadcast', 'sendBroadcast', 'getBroadcast', 'listAudiences', 'createAudience', 'createContact', 'updateContact', 'deleteContact', 'listContacts'];
  const client = Object.fromEntries(
    methods.map((method) => [method, (...args: unknown[]) => { resendCalls.push({ method, args }); return Promise.resolve((resendAnswers[method] ?? (() => ({ ok: true, data: { id: 'b_1' } })))(...args)); }])
  );
  // name is what tells send.ts which provider's audiences and merge tags to use.
  return { ...original, createResendClient: () => ({ name: 'resend', ...client }) };
});

const { sendCampaign, refreshCampaign, campaignReadiness } = await import('./send');

let db: FakeDatabase;
const env = { ...process.env };
const mode = { productColumns: '', productExtras: () => [] };
const options = { locales: ['en', 'de'], mode, scheduledAt: null, shopName: 'Test Shop' };

function campaign(extra: Row = {}): Row {
  const row = { id: db.id(), name: 'Spring', document: sampleDocument(), status: 'draft', locales: {}, recipient_count: 0, scheduled_at: null, sent_at: null, error: null, template_id: null, provider: 'resend', created_at: '', updated_at: '', ...extra };
  db.tables.email_campaigns.push(row);
  return row;
}
function subscribers(locale: string, count: number, extra: Row = {}) {
  for (let i = 0; i < count; i++) {
    db.tables.email_subscribers.push({ id: db.id(), email: `${locale}${i}@example.com`, locale, status: 'subscribed', updated_at: '2026-11-01T00:00:00.000Z', provider_contact_id: `c${i}`, provider_locale: locale, provider_synced_at: '2026-11-02T00:00:00.000Z', ...extra });
  }
}

beforeEach(() => {
  db = new FakeDatabase();
  resendCalls.length = 0;
  resendAnswers = {};
  process.env.RESEND_API_KEY = 're_test';
  process.env.EMAIL_FROM = 'Test Shop <news@example.com>';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://shop.example';
  process.env.NEXT_PUBLIC_SHOP_NAME = 'Test Shop';
});
afterEach(() => {
  process.env = { ...env };
});

describe('campaignReadiness', () => {
  it('counts confirmed people and those still to sync, per language', async () => {
    subscribers('en', 2);
    subscribers('de', 1);
    db.tables.email_subscribers.push({ id: db.id(), email: 'due@example.com', locale: 'de', status: 'subscribed', updated_at: '2026-11-03T00:00:00.000Z', provider_synced_at: null });
    db.tables.email_subscribers.push({ id: db.id(), email: 'pend@example.com', locale: 'en', status: 'pending', updated_at: '2026-11-03T00:00:00.000Z', provider_synced_at: null });
    db.tables.email_audiences.push({ locale: 'en', provider: 'resend', audience_id: 'aud_en' });
    expect(await campaignReadiness(db as never, ['en', 'de'])).toEqual([
      { locale: 'en', subscribed: 2, due: 0, audienceId: 'aud_en' },
      { locale: 'de', subscribed: 2, due: 1, audienceId: null }
    ]);
  });
});

describe('sendCampaign', () => {
  it('sends one broadcast per language with subscribers, skipping empty ones', async () => {
    subscribers('en', 3);
    db.tables.email_audiences.push({ locale: 'en', provider: 'resend', audience_id: 'aud_en' });
    const row = campaign();
    const result = await sendCampaign(db as never, row as never, options);
    expect(result.ok).toBe(true);
    expect(resendCalls.map((call) => call.method)).toEqual(['createBroadcast', 'sendBroadcast']);
    const broadcast = resendCalls[0].args[0] as Record<string, string>;
    expect(broadcast).toMatchObject({ audienceId: 'aud_en', from: 'Test Shop <news@example.com>', subject: 'New in at Test Shop', name: 'Spring (en)', previewText: 'Fresh stock and 15% off' });
    expect(broadcast.html).toContain('Hi {{{FIRST_NAME|there}}}!');
    expect(broadcast.html).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"');
    expect(resendCalls[1].args).toEqual(['b_1', null]);
    expect(row).toMatchObject({ status: 'sending', recipient_count: 3, locales: { en: { broadcastId: 'b_1', recipients: 3, status: 'queued' }, de: { status: 'skipped', recipients: 0 } } });
  });

  it('schedules when asked', async () => {
    subscribers('de', 1);
    db.tables.email_audiences.push({ locale: 'de', provider: 'resend', audience_id: 'aud_de' });
    const row = campaign();
    await sendCampaign(db as never, row as never, { ...options, scheduledAt: '2026-12-01T09:00:00.000Z' });
    expect(resendCalls[1].args).toEqual(['b_1', '2026-12-01T09:00:00.000Z']);
    expect(row).toMatchObject({ status: 'scheduled', scheduled_at: '2026-12-01T09:00:00.000Z', locales: { de: { status: 'scheduled' } } });
  });

  it('refuses when nobody is subscribed, when a list is not synced, and when the row is not a draft', async () => {
    expect(await sendCampaign(db as never, campaign() as never, options)).toEqual({ ok: false, error: 'nobody' });
    subscribers('en', 1, { provider_synced_at: null });
    expect(await sendCampaign(db as never, campaign() as never, options)).toMatchObject({ ok: false, error: 'audience-missing', message: 'en' });
    db.tables.email_audiences.push({ locale: 'en', provider: 'resend', audience_id: 'aud_en' });
    expect(await sendCampaign(db as never, campaign() as never, options)).toMatchObject({ ok: false, error: 'not-synced', message: 'en' });
    db.tables.email_subscribers[0].provider_synced_at = '2026-11-02T00:00:00.000Z';
    expect(await sendCampaign(db as never, campaign({ status: 'sent' }) as never, options)).toEqual({ ok: false, error: 'not-draft' });
    expect(resendCalls).toEqual([]);
  });

  it('sends once however many times the button is pressed', async () => {
    subscribers('en', 1);
    db.tables.email_audiences.push({ locale: 'en', provider: 'resend', audience_id: 'aud_en' });
    const row = campaign();
    await Promise.all([sendCampaign(db as never, row as never, options), sendCampaign(db as never, row as never, options)]);
    expect(resendCalls.filter((call) => call.method === 'sendBroadcast')).toHaveLength(1);
  });

  it('records a provider refusal per language and marks the campaign failed', async () => {
    subscribers('en', 1);
    subscribers('de', 1);
    db.tables.email_audiences.push({ locale: 'en', provider: 'resend', audience_id: 'aud_en' }, { locale: 'de', provider: 'resend', audience_id: 'aud_de' });
    resendAnswers.createBroadcast = (b: unknown) => ((b as { audienceId: string }).audienceId === 'aud_de' ? { ok: false, status: 422, message: 'from not verified', rateLimited: false } : { ok: true, data: { id: 'b_en' } });
    const row = campaign();
    const result = await sendCampaign(db as never, row as never, options);
    expect(result).toMatchObject({ ok: false, error: 'failed', message: 'de: from not verified' });
    expect(row).toMatchObject({ status: 'failed', locales: { en: { status: 'queued', broadcastId: 'b_en' }, de: { status: 'failed', error: 'from not verified' } } });
  });

  it('does nothing without a provider key', async () => {
    delete process.env.RESEND_API_KEY;
    expect(await sendCampaign(db as never, campaign() as never, options)).toEqual({ ok: false, error: 'not-configured' });
  });
});

describe('refreshCampaign', () => {
  it('reads each broadcast\'s status back and stamps sent_at once all are sent', async () => {
    const row = campaign({ status: 'sending', locales: { en: { broadcastId: 'b_en', recipients: 2, status: 'queued' }, de: { broadcastId: null, recipients: 0, status: 'skipped' } } });
    resendAnswers.getBroadcast = () => ({ ok: true, data: { id: 'b_en', status: 'sent', scheduled_at: null, sent_at: '2026-11-05T12:00:00Z' } });
    const updated = await refreshCampaign(db as never, row as never);
    expect(updated).toMatchObject({ status: 'sent', locales: { en: { status: 'sent' } } });
    expect(updated.sent_at).toEqual(expect.any(String));
    // Already sent: the provider is not asked again.
    resendCalls.length = 0;
    await refreshCampaign(db as never, updated);
    expect(resendCalls).toEqual([]);
  });
});
