'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';

import { ADMIN_MFA_MODES, CUSTOMER_SIGN_IN_METHODS } from '@/lib/settings/schema';
import type { StoreSettingsActionResult } from '../actions/storeSettings';

interface AuthSettingsFormProps {
  save: (previous: StoreSettingsActionResult | null, formData: FormData) => Promise<StoreSettingsActionResult>;
  customerSignIn: (typeof CUSTOMER_SIGN_IN_METHODS)[number];
  adminMfa: (typeof ADMIN_MFA_MODES)[number];
  /** True while these still come from the shop's generated configuration. */
  fromDefault: boolean;
}

/** The "Sign-in and security" section of /admin/settings. */
export default function AuthSettingsForm({ save, customerSignIn, adminMfa, fromDefault }: AuthSettingsFormProps) {
  const t = useTranslations('Admin.settings.auth');
  const [result, action, pending] = useActionState(save, null);
  const [mfa, setMfa] = useState(adminMfa);

  return (
    <form action={action} className="space-y-4 rounded-lg border border-border bg-white p-4">
      <div>
        <h3 className="font-semibold">{t('heading')}</h3>
        <p className="mt-1 text-sm text-stone-600">{fromDefault ? t('fromDefault') : t('hint')}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('customerHeading')}</legend>
        {CUSTOMER_SIGN_IN_METHODS.map((method) => (
          <label key={method} className="flex items-start gap-2 text-sm font-normal">
            <input
              type="radio"
              name="customerSignIn"
              value={method}
              defaultChecked={customerSignIn === method}
              className="mt-1"
            />
            <span>
              {t(`customer_${method}`)}
              <span className="block text-xs text-stone-500">{t(`customer_${method}_hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('mfaHeading')}</legend>
        {ADMIN_MFA_MODES.map((mode) => (
          <label key={mode} className="flex items-start gap-2 text-sm font-normal">
            <input
              type="radio"
              name="adminMfa"
              value={mode}
              checked={mfa === mode}
              onChange={() => setMfa(mode)}
              className="mt-1"
            />
            <span>
              {t(`mfa_${mode}`)}
              <span className="block text-xs text-stone-500">{t(`mfa_${mode}_hint`)}</span>
            </span>
          </label>
        ))}
        {mfa === 'off' && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
            {t('mfaOffWarning')}
          </p>
        )}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {pending ? t('saving') : t('save')}
      </button>

      {result?.ok && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">
          {t('savedNotice')}
        </p>
      )}
      {result && !result.ok && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
          {t(`errors.${result.error}`)}
        </p>
      )}
    </form>
  );
}
