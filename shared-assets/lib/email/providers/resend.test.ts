import { describe, expect, it, vi } from 'vitest';

import { createResendClient, RESEND_PASSTHROUGH_TAGS } from './resend';

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: { url: string; method: string; body: unknown; auth: string | undefined }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const next = responses.shift() ?? { status: 500, body: { message: 'no more responses' } };
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: (init?.headers as Record<string, string>)?.Authorization });
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe('createResendClient', () => {
  it('creates a contact with the key and the snake_case body Resend expects', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 201, body: { id: 'c_1' } }]);
    const client = createResendClient({ apiKey: 're_x', fetch: fetchImpl });
    expect(await client.createContact('aud_1', { email: 'sam@example.com', firstName: 'Sam', unsubscribed: false })).toEqual({ ok: true, data: { id: 'c_1' } });
    expect(calls[0]).toMatchObject({
      url: 'https://api.resend.com/audiences/aud_1/contacts',
      method: 'POST',
      auth: 'Bearer re_x',
      body: { email: 'sam@example.com', first_name: 'Sam', unsubscribed: false }
    });
  });

  it('reports a rate limit and other refusals without throwing', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 429, body: { message: 'Too many requests' } },
      { status: 422, body: { message: 'The from address is not verified' } }
    ]);
    const client = createResendClient({ apiKey: 're_x', fetch: fetchImpl });
    expect(await client.createAudience('x')).toEqual({ ok: false, status: 429, message: 'Too many requests', rateLimited: true });
    expect(await client.createAudience('x')).toMatchObject({ ok: false, status: 422, rateLimited: false, message: 'The from address is not verified' });
  });

  it('turns a network failure into a result', async () => {
    const client = createResendClient({ apiKey: 're_x', fetch: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(await client.getBroadcast('b')).toEqual({ ok: false, status: 0, message: 'offline', rateLimited: false });
  });

  it('follows contact pagination', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { data: [{ id: 'c_1', email: 'a@x.co', first_name: null, unsubscribed: false }], has_more: true } },
      { status: 200, body: { data: [{ id: 'c_2', email: 'b@x.co', first_name: 'B', unsubscribed: true }], has_more: false } }
    ]);
    const client = createResendClient({ apiKey: 're_x', fetch: fetchImpl });
    const result = await client.listContacts('aud_1');
    expect(result.ok && result.data.map((c) => c.email)).toEqual(['a@x.co', 'b@x.co']);
    expect(calls[1].url).toContain('after=c_1');
  });

  it('creates and sends a broadcast, scheduled when asked', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 201, body: { id: 'b_1' } }, { status: 200, body: { id: 'b_1' } }]);
    const client = createResendClient({ apiKey: 're_x', fetch: fetchImpl });
    await client.createBroadcast({ audienceId: 'aud_1', from: 'Shop <s@x.co>', replyTo: null, subject: 'Hi', previewText: 'Pre', html: '<p>x</p>', text: 'x', name: 'Spring (de)' });
    await client.sendBroadcast('b_1', '2026-12-01T09:00:00.000Z');
    expect(calls[0].body).toEqual({ audience_id: 'aud_1', from: 'Shop <s@x.co>', subject: 'Hi', preview_text: 'Pre', html: '<p>x</p>', text: 'x', name: 'Spring (de)' });
    expect(calls[1]).toMatchObject({ url: 'https://api.resend.com/broadcasts/b_1/send', body: { scheduled_at: '2026-12-01T09:00:00.000Z' } });
  });
});

describe('RESEND_PASSTHROUGH_TAGS', () => {
  it('writes Resend\'s variables with the owner\'s fallback', () => {
    expect(RESEND_PASSTHROUGH_TAGS['subscriber.first_name']?.('there')).toBe('{{{FIRST_NAME|there}}}');
    expect(RESEND_PASSTHROUGH_TAGS['subscriber.first_name']?.('')).toBe('{{{FIRST_NAME}}}');
    expect(RESEND_PASSTHROUGH_TAGS.unsubscribe_url?.('')).toBe('{{{RESEND_UNSUBSCRIBE_URL}}}');
  });
});
