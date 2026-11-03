'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { addToCartAction } from '@/lib/cart/actions';
import { clampPickerQuantity } from '@/lib/cart/pricing';

interface AddToCartButtonProps {
  locale: string;
  productId: string;
  sizeOptions?: string[] | null;
  colorOptions?: string[] | null;
  /** Out of stock and no backorders: the button stays disabled. */
  soldOut?: boolean;
  /**
   * Show a quantity stepper next to the button. Off by default so the
   * listing cards stay compact; the product page turns it on.
   */
  withQuantity?: boolean;
  /**
   * Most units that can be added in one go, from stock or the per-order
   * cap. Null or undefined means no limit. The server clamps again anyway.
   */
  maxQuantity?: number | null;
  className?: string;
}

export default function AddToCartButton({
  locale,
  productId,
  sizeOptions,
  colorOptions,
  soldOut = false,
  withQuantity = false,
  maxQuantity = null,
  className
}: AddToCartButtonProps) {
  const t = useTranslations('Cart');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const sizes = sizeOptions ?? [];
  const colors = colorOptions ?? [];
  const [size, setSize] = useState(sizes[0] ?? '');
  const [color, setColor] = useState(colors[0] ?? '');
  const [quantity, setQuantity] = useState(1);

  const atMax = typeof maxQuantity === 'number' && quantity >= maxQuantity;
  const changeQuantity = (next: number) =>
    setQuantity(clampPickerQuantity(next, maxQuantity));

  const handleAdd = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await addToCartAction({
        locale,
        productId,
        quantity: withQuantity ? quantity : 1,
        selectedSize: sizes.length > 0 ? size : null,
        selectedColor: colors.length > 0 ? color : null
      });

      if (!result.ok) {
        setMessage(
          result.error === 'out_of_stock' ? t('outOfStock') : t('addFailed')
        );
        return;
      }

      // Confirmation needs to be unmissable, so say so on the button as well
      // as bumping the header badge.
      setAdded(true);
      setMessage(result.adjusted === 'stock' ? t('limitedToStock') : null);
      window.setTimeout(() => setAdded(false), 2000);

      // Refresh so the header count reflects the new line.
      router.refresh();
    });
  };

  if (soldOut) {
    return (
      <Button type="button" disabled className={className}>
        {t('outOfStock')}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      {sizes.length > 0 && (
        <label className="block text-xs font-medium">
          {t('size')}
          <select
            value={size}
            onChange={(event) => setSize(event.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {sizes.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )}

      {colors.length > 0 && (
        <label className="block text-xs font-medium">
          {t('colour')}
          <select
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {colors.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )}

      {withQuantity && (
        <div className="flex flex-wrap items-center gap-3">
          <span id={`quantity-label-${productId}`} className="text-xs font-medium">
            {t('quantity')}
          </span>
          <div
            role="group"
            aria-labelledby={`quantity-label-${productId}`}
            className="inline-flex items-center rounded-md border border-input"
          >
            <button
              type="button"
              aria-label={t('decrease')}
              disabled={pending || quantity <= 1}
              onClick={() => changeQuantity(quantity - 1)}
              className="px-3 py-1 text-lg leading-none disabled:opacity-50"
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={maxQuantity ?? undefined}
              value={quantity}
              aria-label={t('quantity')}
              onChange={(event) => changeQuantity(Number(event.target.value))}
              className="w-14 border-x border-input bg-transparent py-1 text-center text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button
              type="button"
              aria-label={t('increase')}
              disabled={pending || atMax}
              onClick={() => changeQuantity(quantity + 1)}
              className="px-3 py-1 text-lg leading-none disabled:opacity-50"
            >
              +
            </button>
          </div>
          {atMax && <span className="text-xs text-amber-700">{t('maxReached')}</span>}
        </div>
      )}

      <Button
        type="button"
        onClick={handleAdd}
        disabled={pending}
        className={className}
        aria-live="polite"
      >
        {pending ? t('adding') : added ? t('added') : t('addToCart')}
      </Button>

      {message && <p className="text-xs text-amber-700">{message}</p>}
    </div>
  );
}
