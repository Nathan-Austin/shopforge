'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import type { TransactionalKind } from '@/lib/email/brand';
import type { SampleSendResult } from '../actions/emailSamples';

interface SampleSendFormProps {
  send: (previous: SampleSendResult | null, formData: FormData) => Promise<SampleSendResult>;
  kind: TransactionalKind;
  /** False when the shop cannot send at all; the button then explains instead of trying. */
  configured: boolean;
}

/** One button: email me this sample. */
export default function SampleSendForm({ send, kind, configured }: SampleSendFormProps) {
  const t = useTranslations('Admin.email.settings.samples');
  const [result, action, pending] = useActionState(send, null);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="kind" value={kind} />
      <button
        type="submit"
        disabled={pending || !configured}
        title={configured ? undefined : t('notConfigured')}
        className="rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold hover:border-emerald-700 hover:text-emerald-700 disabled:opacity-50"
      >
        {pending ? t('sending') : t('send')}
      </button>
      {result?.ok && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t('sentNotice', { to: result.to })}</p>
      )}
      {result && !result.ok && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {t(`errors.${result.error}`)}
          {result.message ? ` (${result.message})` : ''}
        </p>
      )}
    </form>
  );
}
