import { createHash } from 'node:crypto';

import type { PassthroughTags } from '../campaigns/mergeTags';
import type { CampaignProviderClient, ProviderResult, ProviderAudience, ProviderContact, ProviderBroadcast, NewBroadcast } from './types';

/**
 * Mailchimp as a campaign provider, behind the same shape as Resend.
 *
 * Two things about Mailchimp's model have to be bridged.
 *
 * **One list, tags per language.** Resend has an audience per language;
 * Mailchimp has one audience (a "list") that you segment with tags, and
 * creating a list through the API needs a postal address and campaign
 * defaults that the shop does not have. So the shop uses the list the owner
 * already has, and a tag per language. Everything above this file still
 * thinks in terms of one audience id per locale, so an audience id here is
 * the pair `"<list id>:<tag>"`, packed and unpacked in this file alone.
 *
 * **Members are keyed by address, not by an id.** A member's "id" in
 * Mailchimp is the MD5 of their lowercased email, so creating and updating
 * are the same PUT, and a contact id is derivable rather than remembered.
 * MD5 is Mailchimp's choice of addressing scheme, not a security decision.
 *
 * Transactional mail does not come through here: Mailchimp does not send it
 * (that is Mandrill, a separate product and key). Receipts stay with Resend.
 */

export interface MailchimpClientOptions {
  apiKey: string;
  /** Defaults to the list the key's shop uses; required for campaigns. */
  listId?: string | null;
  fetch?: typeof fetch;
}

/** `*|TAG|*` placeholders Mailchimp fills per recipient. */
export const MAILCHIMP_PASSTHROUGH_TAGS: PassthroughTags = {
  'subscriber.first_name': (fallback) => (fallback ? `*|FNAME:${fallback}|*` : '*|FNAME|*'),
  'subscriber.email': () => '*|EMAIL|*',
  unsubscribe_url: () => '*|UNSUB|*'
};

export const MAILCHIMP_UNSUBSCRIBE_PLACEHOLDER = '*|UNSUB|*';

/**
 * Mailchimp keys end in their data centre: `abc…-us21`. The API lives on
 * that subdomain, so a key without one cannot be used and is worth saying so
 * about rather than failing every call with a DNS error.
 */
export function mailchimpDataCentre(apiKey: string): string | null {
  const match = /-([a-z]{2}\d{1,3})$/.exec(apiKey.trim());
  return match ? match[1] : null;
}

/** A locale's tag on the shared list. */
export function mailchimpTag(locale: string): string {
  return `lang-${locale.toLowerCase()}`;
}

/** Audience ids are `"<list id>:<tag>"`; the rest of the app treats them as opaque. */
export function packAudienceId(listId: string, tag: string): string {
  return `${listId}:${tag}`;
}

export function unpackAudienceId(audienceId: string): { listId: string; tag: string } {
  const at = audienceId.indexOf(':');
  if (at === -1) return { listId: audienceId, tag: '' };
  return { listId: audienceId.slice(0, at), tag: audienceId.slice(at + 1) };
}

/** Mailchimp addresses a member by the MD5 of their lowercased address. */
export function subscriberHash(email: string): string {
  return createHash('md5').update(email.trim().toLowerCase()).digest('hex');
}

interface MailchimpMember {
  id: string;
  email_address: string;
  status: string;
  merge_fields?: { FNAME?: string };
}

export function createMailchimpClient({
  apiKey,
  listId = null,
  fetch: fetchImpl = fetch
}: MailchimpClientOptions): CampaignProviderClient {
  const centre = mailchimpDataCentre(apiKey);
  const endpoint = centre ? `https://${centre}.api.mailchimp.com/3.0` : null;

  async function request<T>(method: string, path: string, body?: unknown): Promise<ProviderResult<T>> {
    if (!endpoint) {
      return {
        ok: false,
        status: 0,
        message: 'That Mailchimp key has no data centre suffix (it should end in something like -us21).',
        rateLimited: false
      };
    }
    try {
      const response = await fetchImpl(`${endpoint}${path}`, {
        method,
        headers: {
          // Mailchimp wants HTTP Basic; the username is ignored.
          Authorization: `Basic ${Buffer.from(`key:${apiKey}`).toString('base64')}`,
          'Content-Type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await response.text();
      const json = text ? (JSON.parse(text) as unknown) : null;
      if (!response.ok) {
        // Mailchimp's errors carry `detail`; `title` is the short form.
        const asRecord = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
        const message =
          (typeof asRecord.detail === 'string' && asRecord.detail) ||
          (typeof asRecord.title === 'string' && asRecord.title) ||
          text.slice(0, 300) ||
          `Mailchimp responded ${response.status}`;
        return { ok: false, status: response.status, message, rateLimited: response.status === 429 };
      }
      return { ok: true, data: json as T };
    } catch (error) {
      return { ok: false, status: 0, message: error instanceof Error ? error.message : 'Network error', rateLimited: false };
    }
  }

  /** The list this shop sends through: the configured one, or its only one. */
  async function resolveListId(): Promise<ProviderResult<string>> {
    if (listId) return { ok: true, data: listId };
    const lists = await request<{ lists: { id: string; name: string }[] }>('GET', '/lists?count=100');
    if (!lists.ok) return lists;
    const found = lists.data.lists ?? [];
    if (found.length === 0) {
      return {
        ok: false,
        status: 0,
        message: 'This Mailchimp account has no audience yet. Create one in Mailchimp first.',
        rateLimited: false
      };
    }
    return { ok: true, data: found[0].id };
  }

  return {
    name: 'mailchimp',

    /**
     * /ping is Mailchimp's own key check. Deliberately not listAudiences:
     * that would also fail for an account with no audience yet, which is a
     * different problem and a different thing to tell the owner.
     */
    async verifyKey(): Promise<ProviderResult<true>> {
      const pong = await request<{ health_status?: string }>('GET', '/ping');
      return pong.ok ? { ok: true, data: true } : pong;
    },

    /** One entry per language tag that already exists on the shop's list. */
    async listAudiences(): Promise<ProviderResult<ProviderAudience[]>> {
      const list = await resolveListId();
      if (!list.ok) return list;
      const tags = await request<{ tags: { id: number; name: string }[] }>(
        'GET',
        `/lists/${list.data}/tag-search?count=200`
      );
      if (!tags.ok) return tags;
      return {
        ok: true,
        data: (tags.data.tags ?? []).map((tag) => ({
          id: packAudienceId(list.data, tag.name),
          name: tag.name
        }))
      };
    },

    /**
     * A tag needs no creating in Mailchimp — it exists once a member carries
     * it — so this resolves the list and hands back the packed id. `name` is
     * the audience name the caller built; the locale tag is taken from it.
     */
    async createAudience(name: string): Promise<ProviderResult<{ id: string }>> {
      const list = await resolveListId();
      if (!list.ok) return list;
      return { ok: true, data: { id: packAudienceId(list.data, name) } };
    },

    async createContact(audienceId, contact): Promise<ProviderResult<{ id: string }>> {
      const { listId: list, tag } = unpackAudienceId(audienceId);
      const hash = subscriberHash(contact.email);
      // PUT is Mailchimp's upsert. status_if_new keeps an existing member's
      // own status (someone who unsubscribed in Mailchimp stays that way).
      const put = await request<MailchimpMember>('PUT', `/lists/${list}/members/${hash}`, {
        email_address: contact.email,
        status_if_new: contact.unsubscribed ? 'unsubscribed' : 'subscribed',
        ...(contact.unsubscribed ? { status: 'unsubscribed' } : {}),
        ...(contact.firstName ? { merge_fields: { FNAME: contact.firstName } } : {})
      });
      if (!put.ok) return put;
      if (tag) {
        const tagged = await request<unknown>('POST', `/lists/${list}/members/${hash}/tags`, {
          tags: [{ name: tag, status: 'active' }]
        });
        if (!tagged.ok) return tagged;
      }
      return { ok: true, data: { id: hash } };
    },

    async updateContact(audienceId, idOrEmail, patch): Promise<ProviderResult<{ id: string }>> {
      const { listId: list, tag } = unpackAudienceId(audienceId);
      // The caller may hold our hash or the address; both resolve to a hash.
      const hash = /^[0-9a-f]{32}$/i.test(idOrEmail) ? idOrEmail.toLowerCase() : subscriberHash(idOrEmail);
      const body: Record<string, unknown> = {};
      if (patch.firstName !== undefined) body.merge_fields = { FNAME: patch.firstName ?? '' };
      if (patch.unsubscribed !== undefined) body.status = patch.unsubscribed ? 'unsubscribed' : 'subscribed';
      const patched = await request<MailchimpMember>('PATCH', `/lists/${list}/members/${hash}`, body);
      if (!patched.ok) return patched;
      if (tag && patch.unsubscribed === false) {
        const tagged = await request<unknown>('POST', `/lists/${list}/members/${hash}/tags`, {
          tags: [{ name: tag, status: 'active' }]
        });
        if (!tagged.ok) return tagged;
      }
      return { ok: true, data: { id: hash } };
    },

    /**
     * Takes the language tag off, rather than deleting the member: the list
     * is shared by every language, and this is called when someone moves
     * from one to another.
     */
    async deleteContact(audienceId, idOrEmail): Promise<ProviderResult<{ deleted: boolean }>> {
      const { listId: list, tag } = unpackAudienceId(audienceId);
      const hash = /^[0-9a-f]{32}$/i.test(idOrEmail) ? idOrEmail.toLowerCase() : subscriberHash(idOrEmail);
      if (!tag) return { ok: true, data: { deleted: false } };
      const removed = await request<unknown>('POST', `/lists/${list}/members/${hash}/tags`, {
        tags: [{ name: tag, status: 'inactive' }]
      });
      if (!removed.ok) return removed;
      return { ok: true, data: { deleted: true } };
    },

    /**
     * The list's members, paged.
     *
     * Not filtered by the language tag: Mailchimp's members endpoint has no
     * tag filter, and for the one thing this is used for — reading back who
     * unsubscribed at the provider — the whole list is the right answer
     * anyway. Someone who unsubscribes in Mailchimp has left the shop's
     * list, not just one language of it.
     */
    async listContacts(audienceId): Promise<ProviderResult<ProviderContact[]>> {
      const { listId: list } = unpackAudienceId(audienceId);
      const all: ProviderContact[] = [];
      const pageSize = 1000;
      for (let page = 0; page < 200; page++) {
        const query = new URLSearchParams({
          count: String(pageSize),
          offset: String(page * pageSize),
          fields: 'members.id,members.email_address,members.status,members.merge_fields,total_items'
        });
        const result = await request<{ members: MailchimpMember[]; total_items: number }>(
          'GET',
          `/lists/${list}/members?${query.toString()}`
        );
        if (!result.ok) return result;
        const members = result.data.members ?? [];
        all.push(
          ...members.map((member) => ({
            id: member.id,
            email: member.email_address,
            first_name: member.merge_fields?.FNAME || null,
            unsubscribed: member.status !== 'subscribed'
          }))
        );
        if (members.length < pageSize) break;
      }
      return { ok: true, data: all };
    },

    /**
     * A campaign aimed at one language's tag. Mailchimp takes the settings
     * and the HTML in two calls, so a failure in the second leaves a draft
     * in Mailchimp rather than something half-sent.
     */
    async createBroadcast(broadcast: NewBroadcast): Promise<ProviderResult<{ id: string }>> {
      const { listId: list, tag } = unpackAudienceId(broadcast.audienceId);
      const { name: fromName, address: fromEmail } = splitFrom(broadcast.from);
      const created = await request<{ id: string }>('POST', '/campaigns', {
        type: 'regular',
        recipients: {
          list_id: list,
          ...(tag
            ? {
                segment_opts: {
                  match: 'all',
                  conditions: [{ condition_type: 'StaticSegment', field: 'static_segment', op: 'static_is', value: tag }]
                }
              }
            : {})
        },
        settings: {
          subject_line: broadcast.subject,
          ...(broadcast.previewText ? { preview_text: broadcast.previewText } : {}),
          title: broadcast.name,
          from_name: fromName,
          reply_to: broadcast.replyTo || fromEmail
        }
      });
      if (!created.ok) return created;

      const content = await request<unknown>('PUT', `/campaigns/${created.data.id}/content`, {
        html: broadcast.html,
        plain_text: broadcast.text
      });
      if (!content.ok) return content;
      return { ok: true, data: { id: created.data.id } };
    },

    async sendBroadcast(id, scheduledAt): Promise<ProviderResult<{ id: string }>> {
      if (scheduledAt) {
        // Mailchimp only schedules on quarter hours, and rejects anything
        // else; rounding up is kinder than an error the owner cannot act on.
        const sent = await request<unknown>('POST', `/campaigns/${id}/actions/schedule`, {
          schedule_time: roundUpToQuarterHour(scheduledAt)
        });
        return sent.ok ? { ok: true, data: { id } } : sent;
      }
      const sent = await request<unknown>('POST', `/campaigns/${id}/actions/send`);
      return sent.ok ? { ok: true, data: { id } } : sent;
    },

    async getBroadcast(id): Promise<ProviderResult<ProviderBroadcast>> {
      const got = await request<{ id: string; status: string; send_time: string | null }>('GET', `/campaigns/${id}`);
      if (!got.ok) return got;
      return {
        ok: true,
        data: {
          id: got.data.id,
          status: mailchimpStatus(got.data.status),
          scheduled_at: got.data.status === 'schedule' ? got.data.send_time : null,
          sent_at: got.data.status === 'sent' ? got.data.send_time : null
        }
      };
    }
  };
}

/** Mailchimp's campaign statuses, in the vocabulary broadcast.ts expects. */
export function mailchimpStatus(status: string): string {
  switch (status) {
    case 'sent':
      return 'sent';
    case 'schedule':
      return 'scheduled';
    case 'sending':
    case 'save':
    case 'paused':
      return 'queued';
    case 'canceled':
    case 'archived':
      return 'canceled';
    default:
      return 'queued';
  }
}

/** `"My Shop <orders@shop.com>"` into the two fields Mailchimp wants. */
export function splitFrom(from: string): { name: string; address: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (match) return { name: match[1].replace(/^"|"$/g, '') || match[2], address: match[2] };
  return { name: from.trim(), address: from.trim() };
}

/** Mailchimp schedules on :00, :15, :30 and :45 only. */
export function roundUpToQuarterHour(iso: string): string {
  const date = new Date(iso);
  const quarter = 15 * 60 * 1000;
  const rounded = new Date(Math.ceil(date.getTime() / quarter) * quarter);
  return rounded.toISOString();
}

export type MailchimpClient = ReturnType<typeof createMailchimpClient>;
