import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getTranslations } from 'next-intl/server';

import { sendEmail } from '@/lib/email/send';
import { createAdminClient } from '@/lib/supabase/admin';
import { newsletterStatus } from './config';
import { renderSubscriptionConfirmation } from './confirmationEmail';
import { confirmUrl } from './links';
import {
  cleanFirstName,
  isLocaleCode,
  normalizeEmail,
  planConfirm,
  planImport,
  planSubscribe,
  type ImportRow,
  type SubscriberSource,
  type SubscriberStatus
} from './rules';
import { signSubscriberToken, verifySubscriberToken } from './tokens';

/**
 * The subscriber list against the database.
 *
 * Sign-up, confirming and unsubscribing come from visitors with no
 * session, so they run with the service-role key, server-side only. The
 * owner's own changes (unsubscribe someone, delete, import) go through
 * here too, after the caller has checked the owner, so that each change
 * and its line in the history are written together.
 */

export const SUBSCRIBER_COLUMNS =
  'id, email, first_name, locale, status, source, consent_text, consented_at, confirmation_sent_at, confirmed_at, unsubscribed_at, created_at';

export interface SubscriberRow {
  id: string;
  email: string;
  first_name: string | null;
  locale: string;
  status: SubscriberStatus;
  source: SubscriberSource;
  consent_text: string;
  consented_at: string;
  confirmation_sent_at: string | null;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
}

type EventName = 'requested' | 'confirmation_sent' | 'confirmed' | 'unsubscribed' | 'imported' | 'resubscribe_requested' | 'edited';

async function logEvent(supabase: SupabaseClient, subscriberId: string, event: EventName, source?: string, detail?: string) {
  const { error } = await supabase
    .from('email_subscriber_events')
    .insert({ subscriber_id: subscriberId, event, source: source ?? null, detail: detail?.slice(0, 500) ?? null });
  // The change itself has happened; a missing history line is logged, not fatal.
  if (error) console.error(`Could not record ${event} for subscriber ${subscriberId}:`, error.message);
}

/** Sends (or re-sends) the confirmation email and records that it went. */
async function sendConfirmation(supabase: SupabaseClient, subscriber: { id: string; email: string; locale: string }): Promise<boolean> {
  const status = newsletterStatus();
  if (!status.enabled) return false;
  const shopName = process.env.NEXT_PUBLIC_SHOP_NAME?.trim() || 'Our shop';
  const t = await getTranslations({ locale: subscriber.locale, namespace: 'Email.subscribe' });
  const url = confirmUrl(status.siteUrl, subscriber.locale, signSubscriberToken(subscriber.id, 'confirm', status.secret));
  const email = renderSubscriptionConfirmation(
    url,
    shopName,
    {
      subject: t('subject', { shop: shopName }),
      headline: t('headline'),
      intro: t('intro', { shop: shopName }),
      button: t('button'),
      expires: t('expires'),
      ignore: t('ignore')
    },
    subscriber.locale
  );
  const result = await sendEmail({ to: subscriber.email, subject: email.subject, html: email.html, text: email.text });
  if (!result.sent) {
    console.error(`Could not send the subscription confirmation for ${subscriber.id}:`, result.reason, result.error ?? '');
    return false;
  }
  await supabase.from('email_subscribers').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', subscriber.id);
  await logEvent(supabase, subscriber.id, 'confirmation_sent');
  return true;
}

export interface SubscriptionRequest {
  email: unknown;
  firstName?: unknown;
  locale: string;
  source: 'footer' | 'checkout';
  /** The consent wording the person saw, in their language. */
  consentText: string;
}

export type SubscriptionRequestResult = { ok: true } | { ok: false; reason: 'invalid-email' | 'unavailable' | 'failed' };

/**
 * A sign-up from the footer or the checkout. The answer is the same
 * whether the address was new, pending or already subscribed, so the form
 * cannot be used to find out who is on the list.
 */
export async function requestSubscription(request: SubscriptionRequest): Promise<SubscriptionRequestResult> {
  if (!newsletterStatus().enabled) return { ok: false, reason: 'unavailable' };
  const email = normalizeEmail(request.email);
  if (!email) return { ok: false, reason: 'invalid-email' };
  if (!isLocaleCode(request.locale)) return { ok: false, reason: 'failed' };
  const firstName = cleanFirstName(request.firstName);
  const supabase = createAdminClient();

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: existing } = await supabase
      .from('email_subscribers')
      .select('id, status, confirmation_sent_at')
      .eq('email', email)
      .maybeSingle();
    const plan = planSubscribe(
      existing ? { id: existing.id, status: existing.status, confirmationSentAt: existing.confirmation_sent_at } : null
    );

    if (plan.action === 'none') return { ok: true };

    if (plan.action === 'create') {
      const { data: created, error } = await supabase
        .from('email_subscribers')
        .insert({ email, first_name: firstName, locale: request.locale, source: request.source, consent_text: request.consentText.slice(0, 1000) })
        .select('id')
        .single();
      // Two sign-ups for one address at once: the other won; plan again.
      if (error?.code === '23505') continue;
      if (error || !created) return { ok: false, reason: 'failed' };
      await logEvent(supabase, created.id, 'requested', request.source);
      await sendConfirmation(supabase, { id: created.id, email, locale: request.locale });
      return { ok: true };
    }

    if (plan.action === 'resubscribe') {
      // Back to pending with the new consent; unsubscribed_at stays as history.
      await supabase
        .from('email_subscribers')
        .update({
          status: 'pending',
          source: request.source,
          locale: request.locale,
          consent_text: request.consentText.slice(0, 1000),
          consented_at: new Date().toISOString(),
          ...(firstName ? { first_name: firstName } : {})
        })
        .eq('id', plan.id);
      await logEvent(supabase, plan.id, 'resubscribe_requested', request.source);
    } else {
      await logEvent(supabase, plan.id, 'requested', request.source);
    }
    await sendConfirmation(supabase, { id: plan.id, email, locale: request.locale });
    return { ok: true };
  }
  return { ok: false, reason: 'failed' };
}

export type LinkState =
  | { valid: true; subscriberId: string; email: string; status: SubscriberStatus; locale: string }
  | { valid: false; reason: 'invalid' | 'expired' | 'unavailable' };

/** Clock skew allowed between a sign-up and the link sent for it. */
const ISSUE_SLACK_MS = 5_000;

/** What a link from an email refers to, without changing anything. */
export async function readSubscriberLink(token: unknown, purpose: 'confirm' | 'unsubscribe'): Promise<LinkState> {
  const status = newsletterStatus();
  if (!status.enabled) return { valid: false, reason: 'unavailable' };
  const check = verifySubscriberToken(token, purpose, status.secret);
  if (!check.ok) return { valid: false, reason: check.reason === 'expired' ? 'expired' : 'invalid' };
  const { data } = await createAdminClient()
    .from('email_subscribers')
    .select('id, email, status, locale, consented_at')
    .eq('id', check.subscriberId)
    .maybeSingle();
  // A deleted subscriber's old link says the same as a broken one.
  if (!data) return { valid: false, reason: 'invalid' };
  // A confirm link belongs to one sign-up: after a newer one (say, after
  // unsubscribing and signing up again) only the newest link confirms.
  if (check.issuedAt !== undefined && check.issuedAt < Date.parse(data.consented_at) - ISSUE_SLACK_MS) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, subscriberId: data.id, email: data.email, status: data.status, locale: data.locale };
}

export type ConfirmResult = 'confirmed' | 'already-subscribed' | 'unsubscribed' | 'invalid' | 'expired' | 'unavailable';

export async function confirmSubscription(token: unknown): Promise<ConfirmResult> {
  const link = await readSubscriberLink(token, 'confirm');
  if (!link.valid) return link.reason;
  const plan = planConfirm(link.status);
  if (plan.action === 'none') return plan.reason;
  const supabase = createAdminClient();
  // Guarded by status, so a double click confirms (and logs) once.
  const { data } = await supabase
    .from('email_subscribers')
    .update({ status: 'subscribed', confirmed_at: new Date().toISOString() })
    .eq('id', link.subscriberId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (data) await logEvent(supabase, link.subscriberId, 'confirmed');
  return 'confirmed';
}

export type UnsubscribeResult = 'unsubscribed' | 'invalid' | 'unavailable';

async function markUnsubscribed(supabase: SupabaseClient, subscriberId: string, via: string): Promise<void> {
  const { data } = await supabase
    .from('email_subscribers')
    .update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() })
    .eq('id', subscriberId)
    .neq('status', 'unsubscribed')
    .select('id')
    .maybeSingle();
  if (data) await logEvent(supabase, subscriberId, 'unsubscribed', via);
}

/**
 * Unsubscribes the person a link belongs to. Unsubscribe links never
 * expire, and doing it twice is not an error.
 */
export async function unsubscribeByToken(token: unknown, via: 'page' | 'one-click'): Promise<UnsubscribeResult> {
  const link = await readSubscriberLink(token, 'unsubscribe');
  if (!link.valid) return link.reason === 'unavailable' ? 'unavailable' : 'invalid';
  await markUnsubscribed(createAdminClient(), link.subscriberId, via);
  return 'unsubscribed';
}

// --- The owner's changes (the caller has checked the owner) -------------------

export async function ownerUnsubscribe(subscriberId: string): Promise<void> {
  await markUnsubscribed(createAdminClient(), subscriberId, 'admin');
}

/** A request to be forgotten: the row and its history go. */
export async function ownerDelete(subscriberId: string): Promise<boolean> {
  const { data } = await createAdminClient().from('email_subscribers').delete().eq('id', subscriberId).select('id').maybeSingle();
  return Boolean(data);
}

/** The owner corrects a name or moves someone to another language. */
export async function ownerEdit(subscriberId: string, changes: { firstName: unknown; locale: unknown }): Promise<'updated' | 'invalid' | 'not-found'> {
  if (!isLocaleCode(changes.locale)) return 'invalid';
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('email_subscribers')
    .update({ first_name: cleanFirstName(changes.firstName), locale: changes.locale })
    .eq('id', subscriberId)
    .select('id')
    .maybeSingle();
  if (!data) return 'not-found';
  await logEvent(supabase, subscriberId, 'edited', 'admin');
  return 'updated';
}

export async function ownerResendConfirmation(subscriberId: string): Promise<'sent' | 'not-pending' | 'failed'> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('email_subscribers').select('id, email, locale, status').eq('id', subscriberId).maybeSingle();
  if (!data || data.status !== 'pending') return 'not-pending';
  return (await sendConfirmation(supabase, data)) ? 'sent' : 'failed';
}

export interface ImportOutcome {
  added: number;
  skippedExisting: number;
  skippedUnsubscribed: number;
}

/**
 * Adds people the owner says already agreed (moving from another list).
 * They are subscribed at once, with the owner's statement as their
 * consent; nobody on the list is changed, and nobody who unsubscribed is
 * brought back.
 */
export async function importSubscribers(rows: ImportRow[], consentText: string): Promise<ImportOutcome> {
  const supabase = createAdminClient();
  const outcome: ImportOutcome = { added: 0, skippedExisting: 0, skippedUnsubscribed: 0 };
  for (let start = 0; start < rows.length; start += 500) {
    const chunk = rows.slice(start, start + 500);
    const { data: known } = await supabase
      .from('email_subscribers')
      .select('email, status')
      .in('email', chunk.map((row) => row.email));
    const existing = new Map((known ?? []).map((row) => [row.email as string, row.status as SubscriberStatus]));
    const fresh: ImportRow[] = [];
    for (const row of chunk) {
      const status = existing.get(row.email);
      const plan = planImport(status ? { status } : null);
      if (plan.action === 'insert') fresh.push(row);
      else if (plan.reason === 'unsubscribed') outcome.skippedUnsubscribed++;
      else outcome.skippedExisting++;
    }
    if (!fresh.length) continue;
    const now = new Date().toISOString();
    const { data: inserted, error } = await supabase
      .from('email_subscribers')
      .upsert(
        fresh.map((row) => ({
          email: row.email,
          first_name: row.firstName,
          locale: row.locale,
          status: 'subscribed',
          source: 'import',
          consent_text: consentText.slice(0, 1000),
          consented_at: now
        })),
        // Someone who signed up while the import ran keeps their own row.
        { onConflict: 'email', ignoreDuplicates: true }
      )
      .select('id');
    if (error) throw new Error(error.message);
    outcome.added += inserted?.length ?? 0;
    outcome.skippedExisting += fresh.length - (inserted?.length ?? 0);
    if (inserted?.length) {
      await supabase
        .from('email_subscriber_events')
        .insert(inserted.map((row) => ({ subscriber_id: row.id, event: 'imported', source: 'import' })));
    }
  }
  return outcome;
}
