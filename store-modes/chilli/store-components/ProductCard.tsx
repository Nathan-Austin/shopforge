'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { StoreProduct } from './types';
import Chip from './Chip';

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
    <article className="group rounded-2xl border border-roh-ash-grey overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
      <Link href={productUrl} className="block">
        <div className="relative bg-gray-100 aspect-square">
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={`${product.name} hot sauce bottle`}
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <svg className="w-16 h-16 text-gray-300" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7l2-7z" />
              </svg>
            </div>
          )}
        </div>
      </Link>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="font-semibold leading-tight flex-1 text-gray-900">
            <Link href={productUrl} className="hover:underline">
              {product.name}
            </Link>
          </h3>
          <div className="flex items-center gap-2 flex-shrink-0">
            {product.heatLevel && (
              <Chip>{product.heatLevel}</Chip>
            )}
            {categoryName && (
              <Chip>{categoryName}</Chip>
            )}
          </div>
        </div>

        <p className="mt-1 text-sm text-gray-600">
          by{' '}
          {brandUrl ? (
            <Link
              href={brandUrl}
              className="underline underline-offset-2 text-gray-700 hover:text-black"
            >
              {brandName}
            </Link>
          ) : (
            <span className="text-gray-700">{brandName}</span>
          )}
        </p>

        {product.description && (
          <p className="mt-2 text-sm text-gray-700 line-clamp-2">
            {product.description}
          </p>
        )}

        {product.chilliTypes && product.chilliTypes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {product.chilliTypes.slice(0, 2).map((chilli) => (
              <Chip key={chilli.id}>
                {chilli.name}
              </Chip>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <div>
            <span className="text-lg font-semibold text-gray-900">
              {(product.price_cents / 100).toLocaleString(locale, {
                style: 'currency',
                currency: product.currency
              })}
            </span>
          </div>
          <Link
            href={productUrl}
            className="inline-flex items-center gap-1 rounded-lg bg-roh-flag-green px-3 py-1.5
                     text-sm font-semibold text-white hover:brightness-95 transition-all"
          >
            {t('actions.seeMore')}
          </Link>
        </div>
      </div>
    </article>
  );
}
