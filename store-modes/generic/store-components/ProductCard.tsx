'use client';

import { useLocale } from 'next-intl';
import Image from 'next/image';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatPrice } from '@/lib/format';
import type { ReactNode } from 'react';
import type { StoreProduct } from './types';

interface ProductCardProps {
  product: StoreProduct;
  specialPrice?: number | null;
  /** Overrides the locale from next-intl (ProductArchive passes it through). */
  locale?: string;
  /**
   * Rendered at the bottom of the card, typically an add-to-cart button.
   * It lives outside the product link on purpose: a button inside an <a>
   * is invalid HTML and swallows the click.
   */
  action?: ReactNode;
}

export default function ProductCard({
  product,
  specialPrice,
  locale: propLocale,
  action,
}: ProductCardProps) {
  const hookLocale = useLocale();
  const locale = propLocale || hookLocale;

  const displayPrice = specialPrice ?? product.price_cents;
  const hasDiscount = specialPrice && specialPrice < product.price_cents;
  const productUrl = `/${locale}/shop/${product.slug}`;

  return (
    <Card className="group overflow-hidden transition-all hover:shadow-lg h-full flex flex-col">
      <CardHeader className="p-0">
        <Link
          href={productUrl}
          className="relative block aspect-square w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800"
        >
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={product.name}
              fill
              className="object-cover transition-transform group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-300">
              <span className="text-4xl">📦</span>
            </div>
          )}
        </Link>
      </CardHeader>
      <CardContent className="p-4 flex flex-col flex-1">
        <div className="space-y-2 flex-1">
          <div className="flex items-center justify-between gap-2">
            {product.category && (
              <Badge variant="secondary" className="font-normal">
                {product.category.name}
              </Badge>
            )}
          </div>

          <h3 className="text-lg font-semibold line-clamp-1">
            <Link href={productUrl} className="group-hover:text-primary transition-colors">
              {product.name}
            </Link>
          </h3>

          {product.description && (
            <p className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
              {product.description}
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          {hasDiscount && (
            <span className="text-sm text-zinc-500 line-through">
              {formatPrice(product.price_cents, product.currency, locale)}
            </span>
          )}
          <span
            className={`text-lg font-bold ${hasDiscount ? 'text-primary' : ''}`}
          >
            {formatPrice(displayPrice, product.currency, locale)}
          </span>
        </div>

        {action && <div className="mt-4">{action}</div>}
      </CardContent>
    </Card>
  );
}
