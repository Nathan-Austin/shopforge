'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import type { ProviderKeyActionResult } from '../actions/emailProviderKey';

interface ProviderChoiceFormProps {
  choose: (previous: ProviderKeyActionResult | null, formData: FormData) => Promise<ProviderKeyActionResult>;
  active: 'resend' | 'mailchimp';
  /** Providers the shop has a stored key for; only these can be chosen. */
  available: readonly ('resend' | 'mailchimp')[];
  /** True when EMAIL_CAMPAIGN_PROVIDER decides instead, and this cannot. */
  lockedByEnvironment: boolean;
}

/** Which provider sends campaigns. Receipts are Resend's either way. */
export default function ProviderChoiceForm({
  choose,
  active,
  available,
  lockedByEnvironment
}: ProviderChoiceFormProps) {
  const t = useTranslations('Admin.email.settings');
  const [result, action, pending] = useActionState(choose, null);

  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-white p-4">
      <h3 className="font-semibold">{t('choiceHeading')}</h3>
      <p className="text-sm text-stone-600">{t('choiceHint')}</p>

      {lockedByEnvironment && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('choiceLocked')}
        </p>
      )}

      <div className="space-y-2">
        {(['resend', 'mailchimp'] as const).map((provider) => {
          const usable = available.includes(provider);
          return (
            <label
              key={provider}
              className={`flex items-start gap-2 text-sm ${usable ? '' : 'text-stone-400'}`}
            >
              <input
                type="radio"
                name="provider"
                value={provider}
                defaultChecked={provider === active}
                disabled={!usable || lockedByEnvironment}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{t(`providers.${provider}`)}</span>
                <span className="block text-xs">
                  {usable ? t(`providerBlurbs.${provider}`) : t('providerNeedsKey')}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <button
        type="submit"
        disabled={pending || lockedByEnvironment || available.length < 2}
        className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {pending ? t('choosing') : t('choose')}
      </button>

      {result?.ok && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {t('chosenNotice', { provider: t(`providers.${result.provider}`) })}
        </p>
      )}
      {result && !result.ok && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {t(`errors.${result.error}`)}
        </p>
      )}
    </form>
  );
}
