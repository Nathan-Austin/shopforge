'use client';

import { useLocale, useTranslations } from 'next-intl';
import Image from 'next/image';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatPrice } from '@/lib/format';
import type { StoreProduct } from './types';

interface ProductCardProps {
  product: StoreProduct;
  specialPrice?: number | null;
}

export default function ProductCard({ product, specialPrice }: ProductCardProps) {
  const locale = useLocale();
  const t = useTranslations('UI');

  const displayPrice = specialPrice ?? product.price_cents;
  const hasDiscount = specialPrice && specialPrice < product.price_cents;
  const productUrl = `/${locale}/shop/${product.slug}`;

  return (
    <Link href={productUrl}>
      <Card className="group overflow-hidden transition-all hover:shadow-lg h-full flex flex-col">
        <CardHeader className="p-0">
          <div className="relative aspect-square w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
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
                <span className="text-4xl">🌶️</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 flex flex-col flex-1">
          <div className="space-y-2 flex-1">
            <div className="flex items-center justify-between gap-2">
              {product.category && (
                <Badge variant="secondary" className="font-normal">
                  {product.category.name}
                </Badge>
              )}
              {product.heatLevel && (
                <span className="text-xs font-bold text-orange-600 uppercase">
                  Level {product.heatLevel}
                </span>
              )}
            </div>
            
            <h3 className="text-lg font-semibold line-clamp-1 group-hover:text-orange-600 transition-colors">
              {product.name}
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
            <span className={`text-lg font-bold ${hasDiscount ? 'text-orange-600' : ''}`}>
              {formatPrice(displayPrice, product.currency, locale)}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
