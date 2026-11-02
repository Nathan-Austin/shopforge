'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { addToCartAction } from '@/lib/cart/actions';

interface AddToCartButtonProps {
  locale: string;
  productId: string;
  sizeOptions?: string[] | null;
  colorOptions?: string[] | null;
  /** Out of stock and no backorders: the button stays disabled. */
  soldOut?: boolean;
  className?: string;
}

export default function AddToCartButton({
  locale,
  productId,
  sizeOptions,
  colorOptions,
  soldOut = false,
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

  const handleAdd = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await addToCartAction({
        locale,
        productId,
        quantity: 1,
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
