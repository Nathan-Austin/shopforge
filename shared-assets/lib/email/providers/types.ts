/**
 * What a campaign provider has to be able to do.
 *
 * Resend and Mailchimp both answer this shape, so `subscribers/sync.ts` and
 * `campaigns/send.ts` are written once against it and neither knows which
 * one it is talking to. Adding a third provider (roadmap H) means another
 * file in this folder and nothing else.
 *
 * Two rules keep the seam honest:
 *
 *   * **Nothing throws.** Every call returns a result, so a 429 can pause a
 *     sync and carry on and any other refusal carries the provider's own
 *     message for the owner to read.
 *   * **An audience id is opaque.** It is whatever the provider needs to
 *     identify one language's recipients — a Resend audience id, or
 *     Mailchimp's `"<list id>:<tag>"`. Only the provider file unpacks it.
 */

export type CampaignProviderName = 'resend' | 'mailchimp';

export type ProviderResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; rateLimited: boolean };

export interface ProviderAudience {
  id: string;
  name: string;
}

export interface ProviderContact {
  id: string;
  email: string;
  first_name: string | null;
  unsubscribed: boolean;
}

export interface NewBroadcast {
  audienceId: string;
  from: string;
  replyTo?: string | null;
  subject: string;
  previewText?: string;
  html: string;
  text: string;
  /** Shown in the provider's own dashboard only. */
  name: string;
}

export interface ProviderBroadcast {
  id: string;
  /** In broadcast.ts's vocabulary: sent, scheduled, queued, canceled, failed. */
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
}

export interface CampaignProviderClient {
  readonly name: CampaignProviderName;
  /**
   * Does this key work? The cheapest authenticated call the provider has,
   * and nothing else: a key check must not fail for a second reason, such
   * as the account having no audience yet.
   */
  verifyKey(): Promise<ProviderResult<true>>;
  listAudiences(): Promise<ProviderResult<ProviderAudience[]>>;
  createAudience(name: string): Promise<ProviderResult<{ id: string }>>;
  createContact(
    audienceId: string,
    contact: { email: string; firstName?: string | null; unsubscribed: boolean }
  ): Promise<ProviderResult<{ id: string }>>;
  updateContact(
    audienceId: string,
    idOrEmail: string,
    patch: { firstName?: string | null; unsubscribed?: boolean }
  ): Promise<ProviderResult<{ id: string }>>;
  deleteContact(audienceId: string, idOrEmail: string): Promise<ProviderResult<{ deleted: boolean }>>;
  listContacts(audienceId: string): Promise<ProviderResult<ProviderContact[]>>;
  createBroadcast(broadcast: NewBroadcast): Promise<ProviderResult<{ id: string }>>;
  /** Sends now, or at `scheduledAt` (ISO 8601) when given. */
  sendBroadcast(id: string, scheduledAt?: string | null): Promise<ProviderResult<{ id: string }>>;
  getBroadcast(id: string): Promise<ProviderResult<ProviderBroadcast>>;
}
