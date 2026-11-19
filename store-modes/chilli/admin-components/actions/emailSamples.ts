'use server';

import { TRANSACTIONAL_KINDS, type TransactionalKind } from '@/lib/email/brand';
import { loadEmailBrand } from '@/lib/email/brandStore';
import { renderSampleEmail } from '@/lib/email/samples';
import { sendEmail } from '@/lib/email/send';
import { ensureShopOwner } from '../lib/auth';

/**
 * "Send me a sample": the receipt, shipping or refund email for an
 * imaginary order, in the admin's language and the saved brand, to the
 * signed-in owner's own address. The transactional path, like a real one;
 * nothing is recorded against any order.
 */

interface Context {
  locale: string;
}

export type SampleSendResult =
  | { ok: true; kind: TransactionalKind; to: string }
  | { ok: false; error: 'not_authorized' | 'unknown_kind' | 'no_address' | 'not_configured' | 'failed'; message?: string };

function isKind(value: string): value is TransactionalKind {
  return (TRANSACTIONAL_KINDS as readonly string[]).includes(value);
}

export async function sendSampleEmail(
  context: Context,
  _previous: SampleSendResult | null,
  formData: FormData
): Promise<SampleSendResult> {
  const { error, supabase, user } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const kind = formData.get('kind')?.toString() ?? '';
  if (!isKind(kind)) return { ok: false, error: 'unknown_kind' };
  const to = user?.email?.trim();
  if (!to) return { ok: false, error: 'no_address' };

  const { brand } = await loadEmailBrand(supabase);
  const email = await renderSampleEmail(kind, context.locale, brand);
  const result = await sendEmail({ to, subject: `[sample] ${email.subject}`, html: email.html, text: email.text });
  if (result.sent) return { ok: true, kind, to };
  return { ok: false, error: result.reason === 'not-configured' ? 'not_configured' : 'failed', message: result.error };
}
