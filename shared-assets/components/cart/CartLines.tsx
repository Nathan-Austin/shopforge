'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { formatPrice } from '@/lib/format';
import {
  removeItemAction,
  setQuantityAction,
  clearCartAction
} from '@/lib/cart/actions';
import type { CartLine } from '@/lib/cart/service';

interface CartLinesProps {
  locale: string;
  lines: CartLine[];
}

export default function CartLines({ locale, lines }: CartLinesProps) {
  const t = useTranslations('Cart');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const run = (action: () => Promise<{ ok: boolean; adjusted?: string }>) => {
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (result.adjusted === 'stock') setNotice(t('limitedToStock'));
      if (!result.ok) setNotice(t('updateFailed'));
      router.refresh();
    });
  };

  const variantLabel = (line: CartLine) =>
    [line.selectedSize, line.selectedColor].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4">
      {notice && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {notice}
        </p>
      )}

      <ul className="divide-y divide-gray-200 border-y border-gray-200">
        {lines.map((line) => {
          const atMax = line.maxQuantity !== null && line.quantity >= line.maxQuantity;

          return (
            <li key={line.id} className="flex gap-4 py-4">
              <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-md bg-gray-100">
                {line.imageUrl ? (
                  <Image
                    src={line.imageUrl}
                    alt={line.name}
                    fill
                    className="object-cover"
                    sizes="80px"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-2xl">📦</div>
                )}
              </div>

              <div className="flex flex-1 flex-col justify-between">
                <div>
                  <p className="font-medium">{line.name}</p>
                  {!line.available && (
                    <p className="text-sm font-medium text-red-700">
                      {t('noLongerAvailable')}
                    </p>
                  )}
                  {variantLabel(line) && (
                    <p className="text-sm text-gray-500">{variantLabel(line)}</p>
                  )}
                  <p className="text-sm text-gray-500">
                    {formatPrice(line.unitPriceCents, line.currency, locale)}
                  </p>
                </div>

                <div className="mt-2 flex items-center gap-3">
                  <div className="inline-flex items-center rounded-md border border-gray-300">
                    <button
                      type="button"
                      aria-label={t('decrease')}
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          setQuantityAction({
                            locale,
                            lineId: line.id,
                            quantity: line.quantity - 1
                          })
                        )
                      }
                      className="px-3 py-1 text-lg leading-none disabled:opacity-50"
                    >
                      −
                    </button>
                    <span className="min-w-8 px-2 text-center text-sm" aria-live="polite">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={t('increase')}
                      disabled={pending || atMax}
                      onClick={() =>
                        run(() =>
                          setQuantityAction({
                            locale,
                            lineId: line.id,
                            quantity: line.quantity + 1
                          })
                        )
                      }
                      className="px-3 py-1 text-lg leading-none disabled:opacity-50"
                    >
                      +
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => removeItemAction({ locale, lineId: line.id }))}
                    className="text-sm text-gray-500 underline hover:text-gray-900 disabled:opacity-50"
                  >
                    {t('remove')}
                  </button>

                  {atMax && (
                    <span className="text-xs text-amber-700">{t('maxReached')}</span>
                  )}
                </div>
              </div>

              <div className="text-right font-semibold">
                {formatPrice(line.unitPriceCents * line.quantity, line.currency, locale)}
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => clearCartAction({ locale }))}
        className="text-sm text-gray-500 underline hover:text-gray-900 disabled:opacity-50"
      >
        {t('clear')}
      </button>
    </div>
  );
}
