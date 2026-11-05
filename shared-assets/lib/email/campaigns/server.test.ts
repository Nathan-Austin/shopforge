import { readFile, rm } from 'node:fs/promises';

import { createTranslator } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emailTmpPath } from '../tmpDir';
import { PRODUCT_ID, sampleDocument } from './fixtures';
import type { EmailTemplate } from './templates';

// server-only refuses to load outside a React server build.
vi.mock('server-only', () => ({}));

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    createTranslator({
      locale,
      namespace: namespace as never,
      messages: {
        Email: {
          campaign: {
            footerReason: 'You subscribed to news from {shop}.',
            unsubscribe: 'Unsubscribe',
            viewProduct: 'View product',
            discountTitle: 'Your code',
            discountHint: 'Enter it at checkout.',
            discountPercent: '{percent}% off',
            discountAmount: '{amount} off',
            discountFreeShipping: 'Free shipping'
          }
        }
      } as never
    })
}));

const sendEmail = vi.fn();
vi.mock('@/lib/email/send', () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));

const { sendCampaignTest, loadDesignerData, searchCatalog } = await import('./server');

const PRODUCT_ROW = {
  id: PRODUCT_ID,
  name: 'Ghost Pepper Sauce',
  slug: 'ghost-pepper',
  price_cents: 899,
  compare_at_price_cents: null,
  currency: 'EUR',
  image_url: null,
  heat_level: 8
};

function discountRow(code: string, overrides: Record<string, unknown> = {}) {
  return {
    id: code,
    code,
    kind: 'percent',
    percent_off: '15',
    amount_off_cents: null,
    currency: null,
    min_subtotal_cents: null,
    starts_at: null,
    ends_at: null,
    max_redemptions: null,
    redemption_count: 0,
    active: true,
    stripe_coupon_id: null,
    stripe_promotion_code_id: null,
    ...overrides
  };
}

type Call = { table: string; method: string; args: unknown[] };

/**
 * A Supabase client whose queries chain like the real builder and resolve
 * to fixed rows per table. Every call is recorded for the assertions.
 */
function fakeSupabase(options: { failProducts?: boolean; discounts?: unknown[] } = {}) {
  const calls: Call[] = [];
  const queries: { table: string; columns: string; values: string[] }[] = [];
  const rows: Record<string, unknown[]> = {
    products_public: [PRODUCT_ROW],
    discount_codes: options.discounts ?? [discountRow('SPRING15')]
  };
  const client = {
    from(table: string) {
      let columns = '';
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'in', 'order', 'limit', 'ilike']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          if (method === 'select') columns = String(args[0]);
          if (method === 'in') queries.push({ table, columns, values: args[1] as string[] });
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        if (table === 'products_public' && options.failProducts) return Promise.reject(new Error('database unreachable')).then(resolve, reject);
        return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve, reject);
      };
      return builder;
    }
  };
  return { client: client as never, queries, calls };
}

const mode = { productColumns: ', heat_level', productExtras: (row: Record<string, unknown>) => [`Heat ${row.heat_level}`] };

function template(document: unknown = sampleDocument()): EmailTemplate {
  return {
    id: 'tpl-1',
    name: 'Spring',
    kind: 'campaign',
    document,
    lastTestSentAt: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z'
  };
}

const LOG_DATE = new Date('2000-01-01T10:00:00Z');
const env = { ...process.env };

beforeEach(() => {
  // A fixed day, so these lines go to their own file and never into today's log.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(LOG_DATE);
  process.env.RESEND_API_KEY = 're_test';
  process.env.EMAIL_FROM = 'Shop <shop@example.com>';
  process.env.NEXT_PUBLIC_SHOP_NAME = 'Test Shop';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://shop.example/';
  sendEmail.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  process.env = { ...env };
  await rm(emailTmpPath('logs', 'test-sends-2000-01-01.jsonl'), { force: true });
});

async function logLines(): Promise<Record<string, unknown>[]> {
  const text = await readFile(emailTmpPath('logs', 'test-sends-2000-01-01.jsonl'), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line));
}

describe('sendCampaignTest', () => {
  it('renders with the shop\'s products and codes, sends, and logs a structured line', async () => {
    sendEmail.mockResolvedValue({ sent: true, id: 'msg_123' });
    const { client, queries } = fakeSupabase();
    const result = await sendCampaignTest(client, { template: template(), to: 'owner@shop.test', locale: 'de', subjectPrefix: '[Test]', mode });

    expect(result).toMatchObject({ ok: true, status: 'sent', messageId: 'msg_123', to: 'o***@shop.test', locale: 'de', provider: 'resend' });
    expect(result.subject).toBe('[Test] Neu bei Test Shop');
    expect(queries.map((q) => q.table)).toEqual(['products_public', 'discount_codes']);
    expect(queries[0].columns).toContain(', heat_level');

    const message = sendEmail.mock.calls[0][0];
    expect(message.to).toBe('owner@shop.test');
    expect(message.html).toContain('Heat 8');
    expect(message.html).toContain('href="https://shop.example/de/shop/ghost-pepper"');
    expect(message.html).toContain('SPRING15');
    // The sample first name stands in for a subscriber's.
    expect(message.html).toContain('Hallo Alex!');

    expect(result.log.file).toBe(emailTmpPath('logs', 'test-sends-2000-01-01.jsonl'));
    const [line] = await logLines();
    expect(line).toMatchObject({ event: 'test-send', status: 'sent', to: 'o***@shop.test', templateId: 'tpl-1' });
    expect(JSON.stringify(line)).not.toContain('owner@shop.test');
  });

  it('does not call the provider when email is not configured, and still logs', async () => {
    delete process.env.RESEND_API_KEY;
    const result = await sendCampaignTest(fakeSupabase().client, { template: template(), to: 'owner@shop.test', locale: 'en', subjectPrefix: '[Test]', mode });
    expect(result).toMatchObject({ ok: false, status: 'not-configured' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await logLines())[0]).toMatchObject({ status: 'not-configured' });
  });

  it('reports the provider\'s refusal', async () => {
    sendEmail.mockResolvedValue({ sent: false, reason: 'failed', error: 'Resend responded 403: domain not verified' });
    const result = await sendCampaignTest(fakeSupabase().client, { template: template(), to: 'owner@shop.test', locale: 'en', subjectPrefix: '[Test]', mode });
    expect(result).toMatchObject({ ok: false, status: 'provider-error', error: 'Resend responded 403: domain not verified' });
  });

  it('refuses an unreadable template with its issues, without sending', async () => {
    const result = await sendCampaignTest(fakeSupabase().client, {
      template: template({ version: 1, blocks: [] }),
      to: 'owner@shop.test',
      locale: 'en',
      subjectPrefix: '[Test]',
      mode
    });
    expect(result.status).toBe('invalid-template');
    expect(result.issues?.length).toBeGreaterThan(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a template with nothing left to send', async () => {
    const document = { ...sampleDocument(), blocks: [{ id: 'p', type: 'product', productId: '22222222-2222-4222-8222-222222222222' }] };
    const result = await sendCampaignTest(fakeSupabase().client, { template: template(document), to: 'owner@shop.test', locale: 'en', subjectPrefix: '[Test]', mode });
    expect(result).toMatchObject({ status: 'empty' });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'missing-product' }));
  });

  it('turns an unexpected failure into a logged result instead of a crash', async () => {
    const result = await sendCampaignTest(fakeSupabase({ failProducts: true }).client, {
      template: template(),
      to: 'owner@shop.test',
      locale: 'en',
      subjectPrefix: '[Test]',
      mode
    });
    expect(result).toMatchObject({ ok: false, status: 'failed', error: 'database unreachable' });
    expect((await logLines())[0]).toMatchObject({ status: 'failed' });
  });

  it('still returns the send result when the log cannot be written', async () => {
    sendEmail.mockResolvedValue({ sent: true, id: 'msg_1' });
    process.env.EMAIL_TMP_DIR = '/home/somewhere/else';
    const result = await sendCampaignTest(fakeSupabase().client, { template: template(), to: 'owner@shop.test', locale: 'en', subjectPrefix: '[Test]', mode });
    expect(result).toMatchObject({ ok: true, status: 'sent' });
    expect(result.log).toEqual({ file: null, error: 'EMAIL_TMP_DIR must be /tmp/sf-<name>-email-builder' });
  });

  it('never hands the database a malformed product id from a stored document', async () => {
    const document = { ...sampleDocument(), blocks: [...sampleDocument().blocks, { id: 'bad', type: 'product', productId: "1' or '1'='1" }] };
    const { client, queries } = fakeSupabase();
    sendEmail.mockResolvedValue({ sent: true, id: 'm' });
    await sendCampaignTest(client, { template: template(document), to: 'owner@shop.test', locale: 'en', subjectPrefix: '[Test]', mode });
    expect(queries[0].values).toEqual([PRODUCT_ID]);
  });
});

describe('loadDesignerData', () => {
  it('loads the catalog, live codes and the wording for every language', async () => {
    const discounts = [
      discountRow('SPRING15'),
      discountRow('SOON', { starts_at: '2000-02-01T00:00:00Z' }),
      discountRow('OLD', { active: false })
    ];
    const { client, calls } = fakeSupabase({ discounts });
    const data = await loadDesignerData(client, sampleDocument(), ['en', 'de'], mode);

    expect(data.shop).toEqual({ name: 'Test Shop', url: 'https://shop.example' });
    expect(data.catalog).toEqual([
      {
        id: PRODUCT_ID,
        name: 'Ghost Pepper Sauce',
        slug: 'ghost-pepper',
        priceCents: 899,
        compareAtPriceCents: null,
        currency: 'EUR',
        imageUrl: null,
        extras: ['Heat 8']
      }
    ]);
    expect(data.discounts).toEqual([
      { code: 'SPRING15', status: 'active' },
      { code: 'SOON', status: 'scheduled' }
    ]);
    expect(Object.keys(data.locales).sort()).toEqual(['de', 'en']);
    expect(data.locales.en.discountLabels).toEqual({ SPRING15: '15% off', SOON: '15% off' });
    expect(data.locales.en.strings.footerReason).toBe('You subscribed to news from Test Shop.');
    // The products the document uses, then a first page for the picker.
    expect(calls.filter((call) => call.table === 'products_public' && call.method === 'limit')).toEqual([
      { table: 'products_public', method: 'limit', args: [24] }
    ]);
  });
});

describe('searchCatalog', () => {
  it('searches names, treating % and _ as plain characters', async () => {
    const { client, calls } = fakeSupabase();
    const results = await searchCatalog(client, ' 100%_hot ', mode);
    expect(results.map((product) => product.id)).toEqual([PRODUCT_ID]);
    expect(calls.find((call) => call.method === 'ilike')?.args).toEqual(['name', '%100\\%\\_hot%']);
  });
});
