'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import type { TestSendResult, TestSendStatus } from '@/lib/email/campaigns/testSendLog';
import { warningText } from './emailWarnings';

interface TestSendFormProps {
  action: (previous: TestSendResult | null, formData: FormData) => Promise<TestSendResult>;
  defaultTo: string;
  defaultLocale: string;
  locales: readonly string[];
  configured: boolean;
}

const STATUS_KEYS: Record<TestSendStatus, string> = {
  sent: 'sent',
  'not-configured': 'notConfigured',
  'provider-error': 'providerError',
  'invalid-template': 'invalidTemplate',
  empty: 'empty',
  'invalid-recipient': 'invalidRecipient',
  'invalid-locale': 'invalidLocale',
  'too-soon': 'tooSoon',
  'not-found': 'notFound',
  'not-authorized': 'notAuthorized',
  failed: 'failed'
};

/** One address, one language; shows the structured result that was logged. */
export default function TestSendForm({ action, defaultTo, defaultLocale, locales, configured }: TestSendFormProps) {
  const t = useTranslations('Admin.email');
  const [result, formAction, pending] = useActionState(action, null);
  const input =
    'mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700';

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-white p-4">
      <div>
        <h3 className="font-semibold">{t('test.heading')}</h3>
        <p className="text-sm text-stone-600">{t('test.intro')}</p>
      </div>
      {!configured && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('notConfigured')}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <label className="block text-sm font-medium">
          {t('test.to')}
          <input type="email" name="to" required defaultValue={defaultTo} autoComplete="email" className={input} />
        </label>
        <label className="block text-sm font-medium">
          {t('test.language')}
          <select name="locale" defaultValue={defaultLocale} className={input}>
            {locales.map((locale) => (
              <option key={locale} value={locale}>
                {locale}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? t('test.sending') : t('test.send')}
      </button>

      {result && (
        <div
          role="status"
          className={`space-y-2 rounded-md border px-3 py-2 text-sm ${
            result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          <p className="font-medium">
            {t(`test.result.${STATUS_KEYS[result.status]}`, {
              to: result.to ?? '',
              id: result.messageId ?? '—',
              error: result.error ?? ''
            })}
          </p>
          {result.durationMs !== undefined && (
            <p>{t('test.details', { duration: result.durationMs, count: result.warnings.length })}</p>
          )}
          {result.warnings.length > 0 && (
            <ul className="list-disc ps-5">
              {result.warnings.map((warning, index) => (
                <li key={index}>{warningText(t, warning)}</li>
              ))}
            </ul>
          )}
          {result.issues && result.issues.length > 0 && (
            <ul className="list-disc ps-5 font-mono text-xs">
              {result.issues.map((issue, index) => (
                <li key={index}>
                  {issue.path ? `${issue.path}: ` : ''}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          <p className="font-mono text-xs opacity-80">
            {result.log.file ? t('test.logged', { file: result.log.file }) : result.log.error ? t('test.notLogged', { error: result.log.error }) : null}
          </p>
        </div>
      )}
    </form>
  );
}
