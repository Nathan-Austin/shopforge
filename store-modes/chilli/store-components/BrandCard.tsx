'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { StoreBrand, StoreProduct } from './types';

interface BrandCardProps {
  brand: StoreBrand;
  products?: StoreProduct[];
  locale?: string;
  websiteUrl?: string;
}

const heatColor = (heatLevel?: string) => {
  if (!heatLevel) return 'bg-red-500';
  const normalized = heatLevel.toLowerCase();
  if (normalized.includes('mild')) return 'bg-green-400';
  if (normalized.includes('medium')) return 'bg-yellow-400';
  if (normalized.includes('hot')) return 'bg-orange-400';
  return 'bg-red-500';
};

export default function BrandCard({
  brand,
  products,
  locale: propLocale,
  websiteUrl
}: BrandCardProps) {
  const hookLocale = useLocale();
  const locale = propLocale || hookLocale;
  const t = useTranslations('UI');
  const productList = products ?? [];
  const productCount = productList.length;
  const displayProducts = productList.slice(0, 3);
  const brandHref = `/${locale}/brands/${brand.slug}`;

  return (
    <div className="card-governmental rounded-lg overflow-hidden shadow-md hover:shadow-lg transition-all duration-200">
      <div className="p-6 border-b border-border">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 bg-gradient-to-br from-roh-accent-orange to-roh-flame-red rounded-full flex items-center justify-center flex-shrink-0 relative overflow-hidden">
            {brand.logo_url ? (
              <Image
                src={brand.logo_url}
                alt={`${brand.name} logo`}
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <span className="text-white text-2xl" aria-hidden="true">
                🏭
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="heading-sm text-text-primary mb-1 line-clamp-1">
              <Link href={brandHref} className="hover:text-roh-accent-orange transition-colors">
                {brand.name}
              </Link>
            </h3>

            {brand.country && (
              <div className="flex items-center text-sm text-text-secondary mb-2">
                <span aria-hidden="true">📍</span>
                <span className="ml-1">{brand.country}</span>
              </div>
            )}

            {brand.description && (
              <p className="body-sm text-text-secondary line-clamp-2">
                {brand.description}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-semibold text-text-primary">{t('product.featuredSauces')}</h4>
          <span className="text-xs text-text-muted">
            {productCount} {productCount === 1 ? t('product.sauce') : t('product.sauces')}
          </span>
        </div>

        {productCount > 0 && (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {displayProducts.map((product) => (
                <div key={product.id} className="relative">
                  <div className="aspect-square bg-gradient-to-br from-roh-accent-orange to-roh-flame-red rounded-lg flex items-center justify-center relative overflow-hidden">
                    {product.image_url ? (
                      <Image
                        src={product.image_url}
                        alt={product.name}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <span className="text-white text-lg" aria-hidden="true">
                        🌶️
                      </span>
                    )}
                  </div>
                  {product.heatLevel && (
                    <div className="absolute -top-1 -right-1 bg-white rounded-full p-1 shadow-sm">
                      <div className={`w-3 h-3 rounded-full ${heatColor(product.heatLevel)}`} />
                    </div>
                  )}
                </div>
              ))}

              {productCount > 3 && (
                <div className="aspect-square bg-card rounded-lg flex items-center justify-center border border-border">
                  <span className="text-text-muted text-xs font-semibold">
                    +{productCount - 3}
                  </span>
                </div>
              )}
            </div>

            <div className="mb-4">
              <div className="space-y-2">
                {displayProducts.slice(0, 2).map((product) => (
                  <div key={product.id} className="flex items-center justify-between text-sm">
                    <Link
                      href={`/${locale}/products/${product.slug}`}
                      className="text-text-secondary hover:text-roh-accent-orange transition-colors truncate"
                    >
                      {product.name}
                    </Link>
                    {product.heatLevel && (
                      <div className="flex items-center gap-1 ml-2">
                        <div className={`w-2 h-2 rounded-full ${heatColor(product.heatLevel)}`} />
                        <span className="text-xs text-text-muted">{product.heatLevel}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="flex gap-2">
          <Link href={brandHref} className="flex-1 text-center btn-secondary text-sm py-2">
            {t('actions.viewProducer')}
          </Link>

          {websiteUrl && (
            <Link
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-card hover:bg-roh-military-olive/20 text-text-secondary rounded transition-colors flex items-center gap-1"
              title={t('actions.visitWebsite')}
            >
              🌐
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
