'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { StoreProduct } from './types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ProductCardProps {
  product: StoreProduct;
  locale?: string;
}

export default function ProductCard({ product, locale: propLocale }: ProductCardProps) {
  const hookLocale = useLocale();
  const locale = propLocale || hookLocale;
  const t = useTranslations('UI');

  const productUrl = `/${locale}/products/${product.slug}`;
  const brandUrl = product.brand?.slug ? `/${locale}/brands/${product.brand.slug}` : null;
  const brandName = product.brand?.name || t('product.unknownProducer');
  const categoryName = product.category?.name || null;

  return (
    <Card className="group overflow-hidden hover:shadow-lg transition-all duration-300 h-full flex flex-col">
      <Link href={productUrl} className="block relative">
        <div className="relative aspect-square bg-muted/50">
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={`${product.name} product image`}
              fill
              className="object-cover transition-transform group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <span className="text-4xl">📦</span>
            </div>
          )}
        </div>
      </Link>

      <CardContent className="p-4 flex flex-col flex-1 gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <Link href={productUrl} className="font-semibold leading-tight hover:underline line-clamp-1">
              {product.name}
            </Link>
            <div className="text-sm text-muted-foreground">
              by{' '}
              {brandUrl ? (
                <Link
                  href={brandUrl}
                  className="font-medium hover:text-foreground transition-colors"
                >
                  {brandName}
                </Link>
              ) : (
                <span>{brandName}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {categoryName && (
            <Badge variant="outline" className="font-normal text-xs">
              {categoryName}
            </Badge>
          )}
        </div>

        {product.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {product.description}
          </p>
        )}

        <div className="mt-auto pt-2 flex items-center justify-between">
          <span className="text-lg font-bold">
            {(product.price_cents / 100).toLocaleString(locale, {
              style: 'currency',
              currency: product.currency
            })}
          </span>
          
          <Button asChild size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
            <Link href={productUrl}>
              {t('actions.seeMore')}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}