'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { BRAND_MODES, SHOP_CURRENCIES, SHOP_NAME_MAX } from '@/lib/settings/schema';
import type { StoreSettingsActionResult } from '../actions/storeSettings';
import { Field, inputClass } from './email-designer/fields';
import ImageField from './email-designer/ImageField';

interface ShopSettingsFormProps {
  save: (previous: StoreSettingsActionResult | null, formData: FormData) => Promise<StoreSettingsActionResult>;
  name: string;
  brands: (typeof BRAND_MODES)[number];
  currency: (typeof SHOP_CURRENCIES)[number];
  logoUrl: string | null;
  /** For the links to whatever still disagrees with a new currency. */
  locale: string;
  /** True while these still come from the generated environment. */
  fromDefault: boolean;
}

/** The "Shop" section of /admin/settings. */
export default function ShopSettingsForm({ save, name, brands, currency, logoUrl, locale, fromDefault }: ShopSettingsFormProps) {
  const t = useTranslations('Admin.settings.shop');
  const [result, action, pending] = useActionState(save, null);
  const [logo, setLogo] = useState(logoUrl ?? '');
  const conflicts = result && !result.ok && result.error === 'currency_conflict' ? result.conflicts : null;

  return (
    <form action={action} className="space-y-4 rounded-lg border border-border bg-white p-4">
      <div>
        <h3 className="font-semibold">{t('heading')}</h3>
        <p className="mt-1 text-sm text-stone-600">{t('hint')}</p>
      </div>

      <Field label={t('name')} hint={fromDefault ? t('nameFromDefault') : t('nameHint')}>
        <input name="name" defaultValue={name} required maxLength={SHOP_NAME_MAX} className={inputClass} />
      </Field>

      <ImageField label={t('logo')} value={logo} onChange={setLogo} hint={t('logoHint')} />
      <input type="hidden" name="logo_url" value={logo} />

      <Field label={t('currency')} hint={t('currencyHint')}>
        <select name="currency" defaultValue={currency} className={inputClass}>
          {SHOP_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
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
      {conflicts && (
        <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
          <p className="font-medium">{t('errors.currency_conflict')}</p>
          {conflicts.products.length > 0 && (
            <>
              <p>{t('conflictProducts', { count: conflicts.productCount })}</p>
              <ul className="list-disc space-y-0.5 ps-5">
                {conflicts.products.map((product) => (
                  <li key={product.id}>
                    <Link href={`/${locale}/admin/products/${product.id}`} className="underline">
                      {product.name}
                    </Link>{' '}
                    — {product.currency}
                  </li>
                ))}
              </ul>
              {conflicts.productCount > conflicts.products.length && (
                <p>{t('conflictMore', { count: conflicts.productCount - conflicts.products.length })}</p>
              )}
            </>
          )}
          {conflicts.discounts.length > 0 && (
            <>
              <p>
                <Link href={`/${locale}/admin/discounts`} className="underline">
                  {t('conflictDiscounts', { count: conflicts.discountCount })}
                </Link>
              </p>
              <ul className="list-disc space-y-0.5 ps-5">
                {conflicts.discounts.map((discount) => (
                  <li key={discount.code}>
                    {discount.code} — {discount.currency}
                  </li>
                ))}
              </ul>
              {conflicts.discountCount > conflicts.discounts.length && (
                <p>{t('conflictMore', { count: conflicts.discountCount - conflicts.discounts.length })}</p>
              )}
            </>
          )}
        </div>
      )}
      {result && !result.ok && result.error !== 'currency_conflict' && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
          {t(`errors.${result.error}`)}
        </p>
      )}
    </form>
  );
}
