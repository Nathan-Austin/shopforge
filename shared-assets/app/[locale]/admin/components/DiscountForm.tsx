'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';

import { DISCOUNT_KINDS, type DiscountKind } from '@/lib/discounts/rules';
import type { DiscountActionResult } from '../actions/discounts';

interface DiscountFormProps {
  action: (previous: DiscountActionResult | null, formData: FormData) => Promise<DiscountActionResult>;
  /** The shop's usual currency, as the default for amount codes. */
  defaultCurrency: string;
}

/** The "new code" form. Field errors come from planNewDiscount on the server. */
export default function DiscountForm({ action, defaultCurrency }: DiscountFormProps) {
  const t = useTranslations('Admin.discounts');
  const [result, formAction, pending] = useActionState(action, null);
  const [kind, setKind] = useState<DiscountKind>('percent');

  const input =
    'mt-1 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700';

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-white p-4">
      <h3 className="font-semibold">{t('newHeading')}</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          {t('code')}
          <input
            type="text"
            name="code"
            required
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            className={`${input} font-mono uppercase`}
          />
          <span className="mt-1 block text-xs font-normal text-stone-500">{t('codeHint')}</span>
        </label>

        <label className="block text-sm font-medium">
          {t('kind')}
          <select
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as DiscountKind)}
            className={input}
          >
            {DISCOUNT_KINDS.map((option) => (
              <option key={option} value={option}>
                {t(`kinds.${option}`)}
              </option>
            ))}
          </select>
        </label>

        {kind === 'percent' && (
          <label className="block text-sm font-medium">
            {t('percent')}
            <input type="number" name="percent" min={0.01} max={100} step={0.01} required className={input} />
          </label>
        )}

        {kind === 'amount' && (
          <label className="block text-sm font-medium">
            {t('amount')}
            <input type="text" name="amount" inputMode="decimal" placeholder="5.00" required className={input} />
          </label>
        )}

        <label className="block text-sm font-medium">
          {t('currency')}
          <input
            type="text"
            name="currency"
            defaultValue={defaultCurrency}
            maxLength={3}
            className={`${input} uppercase`}
          />
        </label>

        <label className="block text-sm font-medium">
          {t('minSubtotal')}
          <input type="text" name="min_subtotal" inputMode="decimal" placeholder="20.00" className={input} />
        </label>

        <label className="block text-sm font-medium">
          {t('maxRedemptions')}
          <input type="number" name="max_redemptions" min={1} step={1} className={input} />
        </label>

        <label className="block text-sm font-medium">
          {t('startsAt')}
          <input type="datetime-local" name="starts_at" className={input} />
        </label>

        <label className="block text-sm font-medium">
          {t('endsAt')}
          <input type="datetime-local" name="ends_at" className={input} />
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {pending ? t('creating') : t('create')}
      </button>

      {result && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            result.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {result.ok
            ? t('created', { code: result.code })
            : t(`errors.${result.error}`, { message: result.message ?? '' })}
        </p>
      )}
    </form>
  );
}
