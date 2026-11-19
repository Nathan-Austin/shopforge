'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';

import { DEFAULT_LOCALE, LOCALES } from '@/i18n/config';
import { MAX_IMPORT_BYTES, parseSubscriberCsv, type CsvImportError } from '@/lib/email/subscribers/csv';
import { importSubscribers, ownerDelete, ownerEdit, ownerResendConfirmation, ownerUnsubscribe } from '@/lib/email/subscribers/service';
import { ensureShopOwner } from '../lib/auth';

interface Context {
  locale: string;
}

export type SubscriberActionResult =
  | { ok: true; action: 'unsubscribed' | 'deleted' | 'resent' | 'updated' }
  | { ok: false; error: 'not_authorized' | 'not_found' | 'not_pending' | 'invalid' | 'failed' };

function refresh(locale: string) {
  revalidatePath(`/${locale}/admin/email/subscribers`);
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function subscriberId(formData: FormData): string | null {
  const id = formData.get('id')?.toString() ?? '';
  return ID_PATTERN.test(id) ? id : null;
}

export async function unsubscribeSubscriber(context: Context, formData: FormData): Promise<SubscriberActionResult> {
  const { error } = await ensureShopOwner();
  if (error) return { ok: false, error: 'not_authorized' };
  const id = subscriberId(formData);
  if (!id) return { ok: false, error: 'not_found' };
  await ownerUnsubscribe(id);
  refresh(context.locale);
  return { ok: true, action: 'unsubscribed' };
}

/** Erasure: the subscriber and their history are gone for good. */
export async function deleteSubscriber(context: Context, formData: FormData): Promise<SubscriberActionResult> {
  const { error } = await ensureShopOwner();
  if (error) return { ok: false, error: 'not_authorized' };
  const id = subscriberId(formData);
  if (!id || !(await ownerDelete(id))) return { ok: false, error: 'not_found' };
  refresh(context.locale);
  return { ok: true, action: 'deleted' };
}

/** A corrected first name or a move to another of the shop's languages. */
export async function editSubscriber(context: Context, formData: FormData): Promise<SubscriberActionResult> {
  const { error } = await ensureShopOwner();
  if (error) return { ok: false, error: 'not_authorized' };
  const id = subscriberId(formData);
  if (!id) return { ok: false, error: 'not_found' };
  const locale = formData.get('locale')?.toString() ?? '';
  if (!(LOCALES as readonly string[]).includes(locale)) return { ok: false, error: 'invalid' };
  const result = await ownerEdit(id, { firstName: formData.get('first_name'), locale });
  refresh(context.locale);
  if (result === 'updated') return { ok: true, action: 'updated' };
  return { ok: false, error: result === 'invalid' ? 'invalid' : 'not_found' };
}

export async function resendSubscriberConfirmation(context: Context, formData: FormData): Promise<SubscriberActionResult> {
  const { error } = await ensureShopOwner();
  if (error) return { ok: false, error: 'not_authorized' };
  const id = subscriberId(formData);
  if (!id) return { ok: false, error: 'not_found' };
  const result = await ownerResendConfirmation(id);
  refresh(context.locale);
  if (result === 'sent') return { ok: true, action: 'resent' };
  return { ok: false, error: result === 'not-pending' ? 'not_pending' : 'failed' };
}

export type ImportResult =
  | {
      ok: true;
      added: number;
      skippedExisting: number;
      skippedUnsubscribed: number;
      duplicates: number;
      invalid: number;
      /** The first few bad lines, to fix in the file. */
      errors: CsvImportError[];
    }
  | { ok: false; error: 'not_authorized' | 'no_file' | 'too_large' | 'no_consent' | 'empty' | 'failed'; message?: string };

/**
 * People from another list, for owners moving to the shop's own. Only with
 * the owner's statement that they agreed to this email, which is stored
 * as their consent; see importSubscribers for what is never changed.
 */
export async function importSubscriberCsv(context: Context, _previous: ImportResult | null, formData: FormData): Promise<ImportResult> {
  const { error } = await ensureShopOwner();
  if (error) return { ok: false, error: 'not_authorized' };
  if (formData.get('consent') !== 'on') return { ok: false, error: 'no_consent' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'no_file' };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: 'too_large' };

  const parsed = parseSubscriberCsv(await file.text(), LOCALES, DEFAULT_LOCALE);
  if (parsed.tooLarge) return { ok: false, error: 'too_large' };
  if (!parsed.rows.length && !parsed.errors.length) return { ok: false, error: 'empty' };

  const t = await getTranslations({ locale: context.locale, namespace: 'Admin.email.subscribers' });
  const shop = process.env.NEXT_PUBLIC_SHOP_NAME?.trim() || 'Our shop';
  try {
    const outcome = await importSubscribers(parsed.rows, t('importConsentRecord', { shop, date: new Date().toISOString().slice(0, 10) }));
    refresh(context.locale);
    return {
      ok: true,
      ...outcome,
      duplicates: parsed.duplicates,
      invalid: parsed.errors.length,
      errors: parsed.errors.slice(0, 10)
    };
  } catch (caught) {
    return { ok: false, error: 'failed', message: caught instanceof Error ? caught.message : String(caught) };
  }
}
