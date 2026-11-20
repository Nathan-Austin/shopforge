'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import { BRAND_MODES, SHOP_NAME_MAX } from '@/lib/settings/schema';
import type { StoreSettingsActionResult } from '../actions/storeSettings';
import { Field, inputClass } from './email-designer/fields';

interface ShopSettingsFormProps {
  save: (previous: StoreSettingsActionResult | null, formData: FormData) => Promise<StoreSettingsActionResult>;
  name: string;
  brands: (typeof BRAND_MODES)[number];
  /** True while these still come from the generated environment. */
  fromDefault: boolean;
}

/** The "Shop" section of /admin/settings. */
export default function ShopSettingsForm({ save, name, brands, fromDefault }: ShopSettingsFormProps) {
  const t = useTranslations('Admin.settings.shop');
  const [result, action, pending] = useActionState(save, null);

  return (
    <form action={action} className="space-y-4 rounded-lg border border-border bg-white p-4">
      <div>
        <h3 className="font-semibold">{t('heading')}</h3>
        <p className="mt-1 text-sm text-stone-600">{t('hint')}</p>
      </div>

      <Field label={t('name')} hint={fromDefault ? t('nameFromDefault') : t('nameHint')}>
        <input name="name" defaultValue={name} required maxLength={SHOP_NAME_MAX} className={inputClass} />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('brandsHeading')}</legend>
        {BRAND_MODES.map((mode) => (
          <label key={mode} className="flex items-start gap-2 text-sm font-normal">
            <input type="radio" name="brands" value={mode} defaultChecked={brands === mode} className="mt-1" />
            <span>
              {t(`brands_${mode}`)}
              <span className="block text-xs text-stone-500">{t(`brands_${mode}_hint`)}</span>
            </span>
          </label>
        ))}
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
