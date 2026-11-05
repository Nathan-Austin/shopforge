'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import type { ImportResult } from '../actions/subscribers';

/** A CSV from another newsletter service, with the owner's word that these people agreed. */
export default function SubscriberImportForm({
  action
}: {
  action: (previous: ImportResult | null, formData: FormData) => Promise<ImportResult>;
}) {
  const t = useTranslations('Admin.email.subscribers');
  const [result, formAction, pending] = useActionState(action, null);
  const errorKeys: Record<Extract<ImportResult, { ok: false }>['error'], string> = {
    not_authorized: 'errors.notAuthorized',
    no_file: 'errors.noFile',
    too_large: 'errors.tooLarge',
    no_consent: 'errors.noConsent',
    empty: 'errors.empty',
    failed: 'errors.failed'
  };

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-white p-4">
      <div>
        <h3 className="font-semibold">{t('importHeading')}</h3>
        <p className="text-sm text-stone-600">{t('importIntro')}</p>
      </div>
      <input type="file" name="file" accept=".csv,text/csv,text/plain" required className="block text-sm" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" required className="mt-1" />
        <span>{t('importConsent')}</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? t('importing') : t('import')}
      </button>
      {result && (
        <div
          role="status"
          className={`space-y-1 rounded-md border px-3 py-2 text-sm ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}
        >
          {result.ok ? (
            <>
              <p className="font-medium">{t('importDone', { added: result.added })}</p>
              <p>
                {t('importSkipped', {
                  existing: result.skippedExisting,
                  unsubscribed: result.skippedUnsubscribed,
                  duplicates: result.duplicates,
                  invalid: result.invalid
                })}
              </p>
              {result.errors.length > 0 && (
                <ul className="list-disc ps-5 font-mono text-xs">
                  {result.errors.map((error) => (
                    <li key={error.line}>{t('importBadLine', { line: error.line, value: error.value || '—' })}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p>{t(errorKeys[result.error], { message: result.message ?? '' })}</p>
          )}
        </div>
      )}
    </form>
  );
}
