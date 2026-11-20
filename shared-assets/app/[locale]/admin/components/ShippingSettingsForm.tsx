'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import type { ShippingSettings } from '@/lib/checkout/pricing';
import { SHIPPING_LABEL_MAX } from '@/lib/settings/schema';
import type { StoreSettingsActionResult } from '../actions/storeSettings';
import { Field, inputClass } from './email-designer/fields';

interface ShippingSettingsFormProps {
  save: (previous: StoreSettingsActionResult | null, formData: FormData) => Promise<StoreSettingsActionResult>;
  shipping: ShippingSettings;
  /** Every country, named in the admin's language, for the home-country pick. */
  countries: readonly { code: string; name: string }[];
  /** The currency the two amounts are in (the shop's, from its config). */
  currency: string;
  /** True while these still come from the shop's generated configuration. */
  fromDefault: boolean;
}

/** Cents as a major-units string for a money input, e.g. 500 -> "5.00". */
function majorUnits(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** The "Shipping" section of /admin/settings. */
export default function ShippingSettingsForm({ save, shipping, countries, currency, fromDefault }: ShippingSettingsFormProps) {
  const t = useTranslations('Admin.settings.shipping');
  const [result, action, pending] = useActionState(save, null);

  return (
    <form action={action} className="space-y-4 rounded-lg border border-border bg-white p-4">
      <div>
        <h3 className="font-semibold">{t('heading')}</h3>
        <p className="mt-1 text-sm text-stone-600">{fromDefault ? t('fromDefault') : t('hint')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('flatRate', { currency })} hint={t('flatRateHint')}>
          <input
            name="flatRate"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={majorUnits(shipping.flatRateCents)}
            className={inputClass}
          />
        </Field>
        <Field label={t('freeShippingThreshold', { currency })} hint={t('freeShippingThresholdHint')}>
          <input
            name="freeShippingThreshold"
            type="number"
            min="0"
            step="0.01"
            defaultValue={shipping.freeShippingThresholdCents === null ? '' : majorUnits(shipping.freeShippingThresholdCents)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label={t('label')} hint={t('labelHint')}>
        <input name="label" required maxLength={SHIPPING_LABEL_MAX} defaultValue={shipping.label} className={inputClass} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('itemWeight')} hint={t('itemWeightHint')}>
          <input
            name="itemWeightGrams"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={shipping.itemWeightGrams}
            className={inputClass}
          />
        </Field>
        <Field label={t('boxWeight')} hint={t('boxWeightHint')}>
          <input
            name="boxWeightGrams"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={shipping.boxWeightGrams}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label={t('homeCountry')} hint={t('homeCountryHint')}>
        <select name="homeCountry" defaultValue={shipping.homeCountry ?? ''} className={inputClass}>
          <option value="">{t('homeCountryUnset')}</option>
          {countries.map(({ code, name }) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </Field>

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
