'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { ProductField, ProductFieldGroup } from '@/lib/products/catalogue';
import type { StoreSettingsActionResult } from '../actions/storeSettings';

interface ProductFieldsFormProps {
  save: (previous: StoreSettingsActionResult | null, formData: FormData) => Promise<StoreSettingsActionResult>;
  /** Every field this shop could offer, grouped, in catalogue order. */
  groups: { group: ProductFieldGroup; fields: ProductField[] }[];
  /** The keys it manages today. */
  keys: string[];
  /** True while these still come from the shop's generated configuration. */
  fromDefault: boolean;
}

/**
 * The "Product fields" section of /admin/settings. Every column exists in
 * the database either way, so switching one on is a setting, never a
 * migration; a field switched off keeps whatever was already stored.
 */
export default function ProductFieldsForm({ save, groups, keys, fromDefault }: ProductFieldsFormProps) {
  const t = useTranslations('Admin.settings.productFields');
  const [result, action, pending] = useActionState(save, null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(keys));

  return (
    <form action={action} className="space-y-4 rounded-lg border border-border bg-white p-4">
      <div>
        <h3 className="font-semibold">{t('heading')}</h3>
        <p className="mt-1 text-sm text-stone-600">{fromDefault ? t('fromDefault') : t('hint')}</p>
      </div>

      <div className="space-y-4">
        {groups.map(({ group, fields }) => (
          <fieldset key={group.key} className="space-y-1">
            <legend className="text-sm font-medium">{group.label}</legend>
            {fields.map((field) => (
              <label key={field.key} className="flex items-start gap-2 py-0.5 text-sm font-normal">
                <input
                  type="checkbox"
                  name="keys"
                  value={field.key}
                  checked={picked.has(field.key)}
                  onChange={(event) =>
                    setPicked((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(field.key);
                      else next.delete(field.key);
                      return next;
                    })
                  }
                  className="mt-1"
                />
                <span>
                  {field.label}
                  {field.help && <span className="block text-xs text-stone-500">{field.help}</span>}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>

      <p className="text-xs text-stone-600" aria-live="polite">
        {t('selected', { count: picked.size })}
      </p>
      <p className="text-xs text-stone-500">{t('switchingOff')}</p>

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
