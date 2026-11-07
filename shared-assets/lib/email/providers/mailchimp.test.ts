import { describe, expect, it, vi } from 'vitest';

import {
  createMailchimpClient,
  mailchimpDataCentre,
  mailchimpStatus,
  mailchimpTag,
  packAudienceId,
  roundUpToQuarterHour,
  splitFrom,
  subscriberHash,
  unpackAudienceId,
  MAILCHIMP_PASSTHROUGH_TAGS
} from './mailchimp';

const KEY = 'abcdef1234567890abcdef1234567890-us21';

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: { url: string; method: string; body: unknown; auth: string | undefined }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const next = responses.shift() ?? { status: 500, body: { detail: 'no more responses' } };
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: (init?.headers as Record<string, string>)?.Authorization
    });
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe('mailchimp helpers', () => {
  it('reads the data centre off the end of the key', () => {
    expect(mailchimpDataCentre(KEY)).toBe('us21');
    expect(mailchimpDataCentre('  key-eu1  ')).toBe('eu1');
    expect(mailchimpDataCentre('no-suffix-here')).toBeNull();
  });

  it('packs and unpacks an audience id without losing a tag that has a colon', () => {
    expect(packAudienceId('list_1', 'lang-de')).toBe('list_1:lang-de');
    expect(unpackAudienceId('list_1:lang-de')).toEqual({ listId: 'list_1', tag: 'lang-de' });
    expect(unpackAudienceId('list_1:a:b')).toEqual({ listId: 'list_1', tag: 'a:b' });
    expect(unpackAudienceId('list_only')).toEqual({ listId: 'list_only', tag: '' });
  });

  it('hashes a member the way Mailchimp addresses them: md5 of the lowercased address', () => {
    // Mailchimp's documented example.
    expect(subscriberHash('urist.mcvankab@freddiesjokes.com')).toBe('62eeb292278cc15f5817cb78f7790b08');
    expect(subscriberHash('  Urist.McVankab@FreddiesJokes.com ')).toBe(subscriberHash('urist.mcvankab@freddiesjokes.com'));
  });

  it('tags a language predictably', () => {
    expect(mailchimpTag('de')).toBe('lang-de');
    expect(mailchimpTag('de-AT')).toBe('lang-de-at');
  });

  it('splits a from address into the two fields Mailchimp wants', () => {
    expect(splitFrom('My Shop <orders@shop.com>')).toEqual({ name: 'My Shop', address: 'orders@shop.com' });
    expect(splitFrom('"My Shop" <orders@shop.com>')).toEqual({ name: 'My Shop', address: 'orders@shop.com' });
    expect(splitFrom('orders@shop.com')).toEqual({ name: 'orders@shop.com', address: 'orders@shop.com' });
  });

  it('rounds a schedule up to the quarter hour Mailchimp insists on', () => {
    expect(roundUpToQuarterHour('2026-11-07T10:01:00.000Z')).toBe('2026-11-07T10:15:00.000Z');
    expect(roundUpToQuarterHour('2026-11-07T10:15:00.000Z')).toBe('2026-11-07T10:15:00.000Z');
    expect(roundUpToQuarterHour('2026-11-07T10:46:30.000Z')).toBe('2026-11-07T11:00:00.000Z');
  });

  it('maps Mailchimp campaign statuses into the shared vocabulary', () => {
    expect(mailchimpStatus('sent')).toBe('sent');
    expect(mailchimpStatus('schedule')).toBe('scheduled');
    expect(mailchimpStatus('save')).toBe('queued');
    expect(mailchimpStatus('canceled')).toBe('canceled');
    expect(mailchimpStatus('something-new')).toBe('queued');
  });

  it('uses Mailchimp merge tags for the recipient fields', () => {
    expect(MAILCHIMP_PASSTHROUGH_TAGS['subscriber.first_name']?.('')).toBe('*|FNAME|*');
    expect(MAILCHIMP_PASSTHROUGH_TAGS['subscriber.first_name']?.('there')).toBe('*|FNAME:there|*');
    expect(MAILCHIMP_PASSTHROUGH_TAGS.unsubscribe_url?.('')).toBe('*|UNSUB|*');
  });
});

describe('createMailchimpClient', () => {
  it('calls the key’s own data centre with basic auth', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { id: 'abc', status: 'sent', send_time: null } }]);
    const client = createMailchimpClient({ apiKey: KEY, listId: 'list_1', fetch: fetchImpl });
    await client.getBroadcast('abc');
    expect(calls[0].url).toBe('https://us21.api.mailchimp.com/3.0/campaigns/abc');
    expect(calls[0].auth).toBe(`Basic ${Buffer.from(`key:${KEY}`).toString('base64')}`);
  });

  it('refuses a key with no data centre suffix rather than guessing a host', async () => {
    const client = createMailchimpClient({ apiKey: 'no-suffix', listId: 'list_1' });
    const result = await client.listAudiences();
    expect(result).toMatchObject({ ok: false, status: 0, rateLimited: false });
    expect(result.ok === false && result.message).toContain('-us21');
  });

  it('upserts a member and tags them with their language', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { id: 'h', email_address: 'sam@x.co', status: 'subscribed' } },
      { status: 200, body: {} }
    ]);
    const client = createMailchimpClient({ apiKey: KEY, listId: 'list_1', fetch: fetchImpl });
    const created = await client.createContact(packAudienceId('list_1', 'lang-de'), {
      email: 'Sam@X.co',
      firstName: 'Sam',
      unsubscribed: false
    });
    expect(created).toEqual({ ok: true, data: { id: subscriberHash('sam@x.co') } });
    expect(calls[0]).toMatchObject({
      url: `https://us21.api.mailchimp.com/3.0/lists/list_1/members/${subscriberHash('sam@x.co')}`,
      method: 'PUT',
      body: { email_address: 'Sam@X.co', status_if_new: 'subscribed', merge_fields: { FNAME: 'Sam' } }
    });
    expect(calls[1]).toMatchObject({
      method: 'POST',
      body: { tags: [{ name: 'lang-de', status: 'active' }] }
    });
  });

  it('removes the language tag rather than deleting a member shared by every language', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: {} }]);
    const client = createMailchimpClient({ apiKey: KEY, listId: 'list_1', fetch: fetchImpl });
    expect(await client.deleteContact(packAudienceId('list_1', 'lang-de'), 'sam@x.co')).toEqual({
      ok: true,
      data: { deleted: true }
    });
    expect(calls[0]).toMatchObject({
      url: `https://us21.api.mailchimp.com/3.0/lists/list_1/members/${subscriberHash('sam@x.co')}/tags`,
      body: { tags: [{ name: 'lang-de', status: 'inactive' }] }
    });
  });

  it('accepts either a hash or an address when updating', async () => {
    const hash = subscriberHash('sam@x.co');
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { id: hash } },
      { status: 200, body: { id: hash } }
    ]);
    const client = createMailchimpClient({ apiKey: KEY, listId: 'list_1', fetch: fetchImpl });
    await client.updateContact(packAudienceId('list_1', 'lang-de'), hash, { unsubscribed: true });
    await client.updateContact(packAudienceId('list_1', 'lang-de'), 'sam@x.co', { unsubscribed: true });
    expect(calls[0].url).toContain(`/members/${hash}`);
    expect(calls[1].url).toContain(`/members/${hash}`);
    expect(calls[0].body).toEqual({ status: 'unsubscribed' });
  });

  it('creates a campaign segmented on the language tag, then puts the HTML', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { id: 'camp_1' } },
      { status: 200, body: {} }
    ]);
    const client = createMailchimpClient({ apiKey: KEY, listId: 'list_1', fetch: fetchImpl });
    const created = await client.createBroadcast({
      audienceId: packAudienceId('list_1', 'lang-de'),
      from: 'My Shop <orders@shop.com>',
      replyTo: null,
      subject: 'Hallo',
      previewText: 'Kurz',
      html: '<p>hi</p>',
      text: 'hi',
      name: 'Spring (de)'
    });
    expect(created).toEqual({ ok: true, data: { id: 'camp_1' } });
    expect(calls[0].body).toMatchObject({
      type: 'regular',
      recipients: { list_id: 'list_1', segment_opts: { conditions: [{ value: 'lang-de' }] } },
      settings: { subject_line: 'Hallo', preview_text: 'Kurz', from_name: 'My Shop', reply_to: 'orders@shop.com' }
    });
    expect(calls[1]).toMatchObject({
      url: 'https://us21.api.mailchimp.com/3.0/campaigns/camp_1/content',
      method: 'PUT',
      body: { html: '<p>hi</p>', plain_text: 'hi' }
    });
  });

  it('does not report a campaign as created when the HTML could not be stored', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 200, body: { id: 'camp_1' } },
      { status: 400, body: { detail: 'Your HTML is too large' } }
    ]);
    const client = createMailchimpClient({ apiKey: KEY, listId: 'list_1', fetch: fetchImpl });
    const created = await client.createBroadcast({
      audienceId: packAudienceId('list_1', 'lang-de'),
      from: 'a@b.co',
      subject: 's',
      html: 'x',
      text: 'x',
      name: 'n'
    });
    expect(created).toMatchObject({ ok: false, status: 400, message: 'Your HTML is too large' });
  });

  it('schedules on a quarter hour and sends immediately otherwise', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 204, body: {} },
      { status: 204, body: {} }
    ]);
    const client = createMailchimpClient({ apiKey: KEY, listId: 'list_1', fetch: fetchImpl });
    await client.sendBroadcast('camp_1', '2026-11-07T10:03:00.000Z');
    await client.sendBroadcast('camp_1', null);
    expect(calls[0]).toMatchObject({
      url: 'https://us21.api.mailchimp.com/3.0/campaigns/camp_1/actions/schedule',
      body: { schedule_time: '2026-11-07T10:15:00.000Z' }
    });
    expect(calls[1].url).toBe('https://us21.api.mailchimp.com/3.0/campaigns/camp_1/actions/send');
  });

  it('reports a rate limit and carries Mailchimp’s own wording', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 429, body: { title: 'Too Many Requests', detail: 'You have exceeded the limit' } },
      { status: 400, body: { detail: 'Invalid Resource' } }
    ]);
    const client = createMailchimpClient({ apiKey: KEY, listId: 'list_1', fetch: fetchImpl });
    expect(await client.getBroadcast('x')).toEqual({
      ok: false,
      status: 429,
      message: 'You have exceeded the limit',
      rateLimited: true
    });
    expect(await client.getBroadcast('x')).toMatchObject({ ok: false, status: 400, rateLimited: false, message: 'Invalid Resource' });
  });

  it('turns a network failure into a result', async () => {
    const client = createMailchimpClient({
      apiKey: KEY,
      listId: 'list_1',
      fetch: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch
    });
    expect(await client.getBroadcast('x')).toEqual({ ok: false, status: 0, message: 'offline', rateLimited: false });
  });

  it('falls back to the account’s only audience when no list is configured', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { lists: [{ id: 'only_list', name: 'My Shop' }] } },
      { status: 200, body: { tags: [{ id: 1, name: 'lang-de' }] } }
    ]);
    const client = createMailchimpClient({ apiKey: KEY, fetch: fetchImpl });
    expect(await client.listAudiences()).toEqual({ ok: true, data: [{ id: 'only_list:lang-de', name: 'lang-de' }] });
    expect(calls[0].url).toContain('/lists?count=100');
  });

  it('says so plainly when the account has no audience at all', async () => {
    const { fetchImpl } = fakeFetch([{ status: 200, body: { lists: [] } }]);
    const client = createMailchimpClient({ apiKey: KEY, fetch: fetchImpl });
    const result = await client.listAudiences();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('no audience');
  });

  it('follows member pagination', async () => {
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `m${i}`,
        email_address: `m${i}@x.co`,
        status: i === 0 ? 'unsubscribed' : 'subscribed',
        merge_fields: { FNAME: 'A' }
      }));
    const { fetchImpl } = fakeFetch([
      { status: 200, body: { members: page(1000), total_items: 1001 } },
      { status: 200, body: { members: page(1), total_items: 1001 } }
    ]);
    const client = createMailchimpClient({ apiKey: KEY, listId: 'list_1', fetch: fetchImpl });
    const result = await client.listContacts('list_1:lang-de');
    expect(result.ok && result.data.length).toBe(1001);
    expect(result.ok && result.data[0]).toEqual({ id: 'm0', email: 'm0@x.co', first_name: 'A', unsubscribed: true });
  });
});
