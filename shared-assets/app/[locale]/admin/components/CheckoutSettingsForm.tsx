'use client';

import { useActionState, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { CHECKOUT_ADDRESS_COLLECTORS } from '@/lib/settings/schema';
import type { StoreSettingsActionResult } from '../actions/storeSettings';

interface CheckoutSettingsFormProps {
  save: (previous: StoreSettingsActionResult | null, formData: FormData) => Promise<StoreSettingsActionResult>;
  shippingAddress: (typeof CHECKOUT_ADDRESS_COLLECTORS)[number];
  allowedCountries: readonly string[];
  /** Every country the shop could deliver to, named in the admin's language. */
  countries: readonly { code: string; name: string }[];
  /** True while these still come from the shop's generated configuration. */
  fromDefault: boolean;
}

/** The "Checkout" section of /admin/settings. */
export default function CheckoutSettingsForm({
  save,
  shippingAddress,
  allowedCountries,
  countries,
  fromDefault
}: CheckoutSettingsFormProps) {
  const t = useTranslations('Admin.settings.checkout');
  const [result, action, pending] = useActionState(save, null);

  const [picked, setPicked] = useState<Set<string>>(() => new Set(allowedCountries));
  const [query, setQuery] = useState('');

  // Filtering hides rows rather than dropping them, so a country picked
  // earlier is still submitted while the list is narrowed.
  const search = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!search) return null;
    return new Set(
      countries.filter(({ code, name }) => name.toLowerCase().includes(search) || code.toLowerCase() === search).map((c) => c.code)
    );
  }, [countries, search]);

  return (
    <form action={action} className="space-y-4 rounded-lg border border-border bg-white p-4">
      <div>
        <h3 className="font-semibold">{t('heading')}</h3>
        <p className="mt-1 text-sm text-stone-600">{t('hint')}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('addressHeading')}</legend>
        {CHECKOUT_ADDRESS_COLLECTORS.map((collector) => (
          <label key={collector} className="flex items-start gap-2 text-sm font-normal">
            <input
              type="radio"
              name="shippingAddress"
              value={collector}
              defaultChecked={shippingAddress === collector}
              className="mt-1"
            />
            <span>
              {t(`address_${collector}`)}
              <span className="block text-xs text-stone-500">{t(`address_${collector}_hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="space-y-2">
        <div className="text-sm font-medium">{t('countries')}</div>
        <p className="text-xs text-stone-500">{fromDefault ? t('countriesFromDefault') : t('countriesHint')}</p>

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="block w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
        />

        <div className="max-h-64 overflow-y-auto rounded-md border border-border p-2">
          <ul>
            {countries.map(({ code, name }) => (
              <li key={code} className={visible && !visible.has(code) ? 'hidden' : undefined}>
                <label className="flex items-center gap-2 py-0.5 text-sm font-normal">
                  <input
                    type="checkbox"
                    name="countries"
                    value={code}
                    checked={picked.has(code)}
                    onChange={(event) =>
                      setPicked((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(code);
                        else next.delete(code);
                        return next;
                      })
                    }
                  />
                  <span>{name}</span>
                  <span className="text-xs text-stone-400">{code}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-stone-600" aria-live="polite">
          {t('selected', { count: picked.size })}
        </p>
      </div>

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
