/**
 * The subscriber list's rules, as pure functions.
 *
 * Signing up never tells the visitor whether an address is already on the
 * list (that would let anyone test addresses), so every sign-up answers
 * the same "check your inbox" and the plan below decides quietly whether a
 * confirmation email goes out. A person who unsubscribed can come back,
 * but only by confirming again; an import never brings them back.
 */

import { z } from 'zod';

import { LOCALE_CODE_PATTERN } from '../../i18n/locales';

export type SubscriberStatus = 'pending' | 'subscribed' | 'unsubscribed';
export type SubscriberSource = 'footer' | 'checkout' | 'import' | 'admin';

export const SUBSCRIBER_STATUSES: SubscriberStatus[] = ['pending', 'subscribed', 'unsubscribed'];

/** A second confirmation email to the same address waits this long. */
export const CONFIRMATION_COOLDOWN_MS = 10 * 60 * 1000;

export const FIRST_NAME_MAX = 100;

export interface ExistingSubscriber {
  id: string;
  status: SubscriberStatus;
  confirmationSentAt: string | null;
}

const emailSchema = z.email().max(254);

/** Lowercase and trimmed, or null when it is not an address. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const email = input.trim().toLowerCase();
  return emailSchema.safeParse(email).success ? email : null;
}

/** Trimmed, collapsed, at most FIRST_NAME_MAX characters; null when empty. */
export function cleanFirstName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.replace(/\s+/g, ' ').trim().slice(0, FIRST_NAME_MAX);
  return name || null;
}

export function isLocaleCode(input: unknown): input is string {
  return typeof input === 'string' && LOCALE_CODE_PATTERN.test(input);
}

export type SubscribePlan =
  /** New address: a pending row and a confirmation email. */
  | { action: 'create' }
  /** Still pending: send the confirmation again. */
  | { action: 'resend'; id: string }
  /** Left the list before: pending again, with a fresh consent and email. */
  | { action: 'resubscribe'; id: string }
  /** Nothing to do, and no email: already on the list, or just emailed. */
  | { action: 'none'; reason: 'already-subscribed' | 'cooldown' };

export function planSubscribe(existing: ExistingSubscriber | null, now: Date = new Date()): SubscribePlan {
  if (!existing) return { action: 'create' };
  switch (existing.status) {
    case 'subscribed':
      return { action: 'none', reason: 'already-subscribed' };
    case 'unsubscribed':
      return { action: 'resubscribe', id: existing.id };
    case 'pending': {
      const sent = existing.confirmationSentAt ? Date.parse(existing.confirmationSentAt) : Number.NaN;
      if (Number.isFinite(sent) && now.getTime() - sent < CONFIRMATION_COOLDOWN_MS) return { action: 'none', reason: 'cooldown' };
      return { action: 'resend', id: existing.id };
    }
  }
}

export type ConfirmPlan = { action: 'confirm' } | { action: 'none'; reason: 'already-subscribed' | 'unsubscribed' };

/**
 * A confirmation link from before someone unsubscribed must not put them
 * back on the list; only a new sign-up does.
 */
export function planConfirm(status: SubscriberStatus): ConfirmPlan {
  if (status === 'pending') return { action: 'confirm' };
  return { action: 'none', reason: status === 'subscribed' ? 'already-subscribed' : 'unsubscribed' };
}

export interface ImportRow {
  email: string;
  firstName: string | null;
  locale: string;
}

export type ImportPlan = { action: 'insert' } | { action: 'skip'; reason: 'exists' | 'unsubscribed' };

/**
 * An import adds people who are not on the list yet. It never overwrites a
 * row: someone who unsubscribed stays unsubscribed, whatever the old list
 * says, and an existing subscriber keeps their own details.
 */
export function planImport(existing: { status: SubscriberStatus } | null): ImportPlan {
  if (!existing) return { action: 'insert' };
  return { action: 'skip', reason: existing.status === 'unsubscribed' ? 'unsubscribed' : 'exists' };
}
