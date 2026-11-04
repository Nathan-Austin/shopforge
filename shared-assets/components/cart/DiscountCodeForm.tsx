'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { formatPrice } from '@/lib/format';
import { applyDiscountAction, removeDiscountAction } from '@/lib/discounts/actions';
import type { DiscountError } from '@/lib/discounts/rules';

interface DiscountCodeFormProps {
  locale: string;
  /** The code currently applied, if any. */
  appliedCode: string | null;
  /**
   * Why the applied code no longer counts, if it does not (retired since,
   * cart dropped below the minimum, ...). Shown next to the code so the
   * customer knows before they pay.
   */
  problem?: { error: DiscountError; minimumCents?: number } | null;
  currency: string;
}

/** Promo code entry on the cart and checkout pages. */
export default function DiscountCodeForm({
  locale,
  appliedCode,
  problem,
  currency
}: DiscountCodeFormProps) {
  const t = useTranslations('Cart.discount');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const describe = (key: string, minimumCents?: number) =>
    t(`errors.${key}`, {
      minimum: minimumCents !== undefined ? formatPrice(minimumCents, currency, locale) : ''
    });

  const apply = () => {
    setError(null);
    startTransition(async () => {
      const result = await applyDiscountAction({ locale, code });
      if (!result.ok) {
        setError(describe(result.error === 'empty_cart' ? 'failed' : result.error, result.minimumCents));
        return;
      }
      setCode('');
      router.refresh();
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      await removeDiscountAction({ locale });
      router.refresh();
    });
  };

  if (appliedCode) {
    return (
      <div className="space-y-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-xs font-semibold">
            {appliedCode}
          </span>
          <span>{t('applied', { code: appliedCode })}</span>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="text-gray-500 underline hover:text-gray-900 disabled:opacity-50"
          >
            {t('remove')}
          </button>
        </div>
        {problem && (
          <p className="text-amber-700" role="alert">
            {describe(problem.error, problem.minimumCents)}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className="space-y-1 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <label htmlFor="discount-code" className="block text-xs font-medium">
        {t('label')}
      </label>
      <div className="flex gap-2">
        <input
          id="discount-code"
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={t('placeholder')}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={32}
          className="h-9 w-48 rounded-md border border-gray-300 bg-transparent px-2 font-mono text-sm uppercase"
        />
        <button
          type="submit"
          disabled={pending || code.trim() === ''}
          className="rounded-md border border-gray-300 px-3 font-semibold hover:bg-gray-50 disabled:opacity-50"
        >
          {pending ? t('applying') : t('apply')}
        </button>
      </div>
      {error && (
        <p className="text-red-700" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
