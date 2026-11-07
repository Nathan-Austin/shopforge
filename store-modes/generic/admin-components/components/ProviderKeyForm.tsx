'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';

import type { ProviderKeyActionResult } from '../actions/emailProviderKey';

export interface StoredProviderKey {
  provider: 'resend' | 'mailchimp';
  lastFour: string | null;
  /** Already formatted for the admin's locale by the page. */
  setAt: string;
  isActive: boolean;
  /** True when this provider's key comes from the environment instead. */
  fromEnvironment: boolean;
}

interface ProviderKeyFormProps {
  provider: 'resend' | 'mailchimp';
  save: (previous: ProviderKeyActionResult | null, formData: FormData) => Promise<ProviderKeyActionResult>;
  clear: (previous: ProviderKeyActionResult | null, formData: FormData) => Promise<ProviderKeyActionResult>;
  stored: StoredProviderKey | null;
  fromEnvironment: boolean;
  /** Only shown for the provider that is not currently sending. */
  canSend: boolean;
}

/**
 * Entering one provider's key.
 *
 * Write-only: the field is a password input that is emptied the moment the
 * key is accepted, and nothing on this page can show the key again. The
 * message after saving says so plainly, because the owner's next thought is
 * "where do I find it again" and the answer is the provider, not here.
 */
export default function ProviderKeyForm({
  provider,
  save,
  clear,
  stored,
  fromEnvironment,
  canSend
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
    <div className="space-y-3 rounded-lg border border-border bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{t(`providers.${provider}`)}</h3>
        {canSend && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
            {t('activeBadge')}
          </span>
        )}
      </div>

      {fromEnvironment && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('fromEnvironment', { variable: provider === 'mailchimp' ? 'MAILCHIMP_API_KEY' : 'RESEND_API_KEY' })}
        </p>
      )}

      <p className="text-sm text-stone-700">
        {stored
          ? stored.lastFour
            ? t('storedWithHint', { hint: stored.lastFour, date: stored.setAt })
            : t('stored', { date: stored.setAt })
          : t('notStored')}
      </p>

      <form ref={formRef} action={saveAction} className="space-y-3">
        <input type="hidden" name="provider" value={provider} />
        <label className="block text-sm font-medium">
          {stored ? t('replaceLabel') : t('keyLabel')}
          <input
            type="password"
            name="api_key"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder={t(`keyPlaceholders.${provider}`)}
            className={input}
          />
        </label>
        <p className="text-xs text-stone-500">{t(`keyHints.${provider}`)}</p>
        <p className="text-xs text-stone-500">{t('writeOnlyWarning')}</p>

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
        <form action={clearAction} className="border-t border-border pt-3">
          <input type="hidden" name="provider" value={provider} />
          <button
            type="submit"
            disabled={clearing}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50"
          >
            {clearing ? t('removing') : t('remove')}
          </button>
          <p className="mt-2 text-xs text-stone-500">{t('removeHint')}</p>
          {clearResult?.ok && (
            <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {t('removedNotice')}
            </p>
          )}
          {clearResult && !clearResult.ok && (
            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              {t(`errors.${clearResult.error}`)}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
