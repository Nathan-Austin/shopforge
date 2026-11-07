'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';

import type { ProviderKeyActionResult } from '../actions/emailProviderKey';

interface ProviderKeyFormProps {
  save: (previous: ProviderKeyActionResult | null, formData: FormData) => Promise<ProviderKeyActionResult>;
  clear: (previous: ProviderKeyActionResult | null, formData: FormData) => Promise<ProviderKeyActionResult>;
  /** Whether a key is already stored, and the only thing we may show of it. */
  stored: { lastFour: string | null; setAt: string } | null;
  /** True when RESEND_API_KEY is set, which wins over anything stored here. */
  fromEnvironment: boolean;
  formattedSetAt: string | null;
}

/**
 * Entering the provider key.
 *
 * Write-only: the field is a password input that is emptied the moment the
 * key is accepted, and nothing on this page can show the key again. The
 * message after saving says so plainly, because the owner's next thought is
 * "where do I find it again" and the answer is the provider, not here.
 */
export default function ProviderKeyForm({
  save,
  clear,
  stored,
  fromEnvironment,
  formattedSetAt
}: ProviderKeyFormProps) {
  const t = useTranslations('Admin.email.settings');
  const [saveResult, saveAction, saving] = useActionState(save, null);
  const [clearResult, clearAction, clearing] = useActionState(clear, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the field as soon as the key is stored, so it is not left sitting
  // in the DOM (or in a password manager's "save this?" prompt) afterwards.
  useEffect(() => {
    if (saveResult?.ok) formRef.current?.reset();
  }, [saveResult]);

  const input =
    'mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700';

  return (
    <div className="space-y-4">
      {fromEnvironment && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('fromEnvironment')}
        </p>
      )}

      <div className="rounded-lg border border-border bg-white p-4 text-sm">
        <h3 className="font-semibold">{t('statusHeading')}</h3>
        {stored ? (
          <p className="mt-1 text-stone-700">
            {stored.lastFour
              ? t('storedWithHint', { hint: stored.lastFour, date: formattedSetAt ?? '' })
              : t('stored', { date: formattedSetAt ?? '' })}
          </p>
        ) : (
          <p className="mt-1 text-stone-600">{t('notStored')}</p>
        )}
      </div>

      <form ref={formRef} action={saveAction} className="space-y-3 rounded-lg border border-border bg-white p-4">
        <h3 className="font-semibold">{stored ? t('replaceHeading') : t('addHeading')}</h3>
        <p className="text-sm text-stone-600">{t('writeOnlyWarning')}</p>

        <label className="block text-sm font-medium">
          {t('keyLabel')}
          <input
            type="password"
            name="api_key"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder={t('keyPlaceholder')}
            className={input}
          />
        </label>
        <p className="text-xs text-stone-500">{t('keyHint')}</p>

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {saving ? t('testing') : t('testAndSave')}
        </button>

        {saveResult?.ok && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {t('savedNotice', { hint: saveResult.lastFour ?? '' })}
          </p>
        )}
        {saveResult && !saveResult.ok && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {t(`errors.${saveResult.error}`)}
            {saveResult.message ? ` (${saveResult.message})` : ''}
          </p>
        )}
      </form>

      {stored && (
        <form action={clearAction} className="rounded-lg border border-border bg-white p-4">
          <h3 className="font-semibold">{t('removeHeading')}</h3>
          <p className="mt-1 text-sm text-stone-600">{t('removeHint')}</p>
          <button
            type="submit"
            disabled={clearing}
            className="mt-3 rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50"
          >
            {clearing ? t('removing') : t('remove')}
          </button>
          {clearResult?.ok && (
            <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {t('removedNotice')}
            </p>
          )}
          {clearResult && !clearResult.ok && (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              {t(`errors.${clearResult.error}`)}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
