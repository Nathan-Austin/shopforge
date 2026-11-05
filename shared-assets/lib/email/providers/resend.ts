/**
 * Resend's audiences, contacts and broadcasts, over its REST API with
 * fetch (no SDK, like the transactional sender). The campaign provider
 * for shops that send a newsletter a month to a few thousand people.
 *
 * Every call returns a plain result rather than throwing: a 429 says
 * `rateLimited`, so a sync can pause and carry on, and any other refusal
 * carries Resend's message for the owner to read.
 */

import type { PassthroughTags } from '../campaigns/mergeTags';

const ENDPOINT = 'https://api.resend.com';

export type ResendResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; rateLimited: boolean };

export interface ResendClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

export interface ResendAudience {
  id: string;
  name: string;
}

export interface ResendContact {
  id: string;
  email: string;
  first_name: string | null;
  unsubscribed: boolean;
}

export type ResendBroadcastStatus = 'draft' | 'queued' | 'scheduled' | 'sent' | 'canceled' | 'failed' | string;

export interface ResendBroadcast {
  id: string;
  status: ResendBroadcastStatus;
  scheduled_at: string | null;
  sent_at: string | null;
}

export interface NewBroadcast {
  audienceId: string;
  from: string;
  replyTo?: string | null;
  subject: string;
  previewText?: string;
  html: string;
  text: string;
  /** Shown in Resend's dashboard only. */
  name: string;
}

export function createResendClient({ apiKey, fetch: fetchImpl = fetch }: ResendClientOptions) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<ResendResult<T>> {
    try {
      const response = await fetchImpl(`${ENDPOINT}${path}`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await response.text();
      const json = text ? (JSON.parse(text) as unknown) : null;
      if (!response.ok) {
        const message = json && typeof json === 'object' && 'message' in json ? String((json as { message: unknown }).message) : text.slice(0, 300);
        return { ok: false, status: response.status, message: message || `Resend responded ${response.status}`, rateLimited: response.status === 429 };
      }
      return { ok: true, data: json as T };
    } catch (error) {
      return { ok: false, status: 0, message: error instanceof Error ? error.message : 'Network error', rateLimited: false };
    }
  }

  return {
    listAudiences: () => request<{ data: ResendAudience[] }>('GET', '/audiences').then((r) => (r.ok ? { ok: true as const, data: r.data.data } : r)),
    createAudience: (name: string) => request<{ id: string }>('POST', '/audiences', { name }),
    createContact: (audienceId: string, contact: { email: string; firstName?: string | null; unsubscribed: boolean }) =>
      request<{ id: string }>('POST', `/audiences/${audienceId}/contacts`, {
        email: contact.email,
        ...(contact.firstName ? { first_name: contact.firstName } : {}),
        unsubscribed: contact.unsubscribed
      }),
    updateContact: (audienceId: string, idOrEmail: string, patch: { firstName?: string | null; unsubscribed?: boolean }) =>
      request<{ id: string }>('PATCH', `/audiences/${audienceId}/contacts/${encodeURIComponent(idOrEmail)}`, {
        ...(patch.firstName !== undefined ? { first_name: patch.firstName ?? '' } : {}),
        ...(patch.unsubscribed !== undefined ? { unsubscribed: patch.unsubscribed } : {})
      }),
    deleteContact: (audienceId: string, idOrEmail: string) =>
      request<{ deleted: boolean }>('DELETE', `/audiences/${audienceId}/contacts/${encodeURIComponent(idOrEmail)}`),
    /** Every contact of an audience; follows pagination where Resend offers it. */
    async listContacts(audienceId: string): Promise<ResendResult<ResendContact[]>> {
      const all: ResendContact[] = [];
      let after: string | null = null;
      for (let page = 0; page < 200; page++) {
        const query: string = after ? `?limit=100&after=${encodeURIComponent(after)}` : '?limit=100';
        const result: ResendResult<{ data: ResendContact[]; has_more?: boolean }> = await request('GET', `/audiences/${audienceId}/contacts${query}`);
        if (!result.ok) return result;
        all.push(...result.data.data);
        if (!result.data.has_more || result.data.data.length === 0) break;
        after = result.data.data[result.data.data.length - 1].id;
      }
      return { ok: true, data: all };
    },
    createBroadcast: (broadcast: NewBroadcast) =>
      request<{ id: string }>('POST', '/broadcasts', {
        audience_id: broadcast.audienceId,
        from: broadcast.from,
        ...(broadcast.replyTo ? { reply_to: broadcast.replyTo } : {}),
        subject: broadcast.subject,
        ...(broadcast.previewText ? { preview_text: broadcast.previewText } : {}),
        html: broadcast.html,
        text: broadcast.text,
        name: broadcast.name
      }),
    /** Sends now, or at `scheduledAt` (ISO 8601) when given. */
    sendBroadcast: (id: string, scheduledAt?: string | null) =>
      request<{ id: string }>('POST', `/broadcasts/${id}/send`, scheduledAt ? { scheduled_at: scheduledAt } : {}),
    getBroadcast: (id: string) => request<ResendBroadcast>('GET', `/broadcasts/${id}`)
  };
}

export type ResendClient = ReturnType<typeof createResendClient>;

/** Resend's broadcast merge variables, in place of our recipient tags. */
export const RESEND_PASSTHROUGH_TAGS: PassthroughTags = {
  'subscriber.first_name': (fallback) => (fallback ? `{{{FIRST_NAME|${fallback}}}}` : '{{{FIRST_NAME}}}'),
  'subscriber.email': () => '{{{EMAIL}}}',
  unsubscribe_url: () => '{{{RESEND_UNSUBSCRIBE_URL}}}'
};

export const RESEND_UNSUBSCRIBE_PLACEHOLDER = '{{{RESEND_UNSUBSCRIBE_URL}}}';
