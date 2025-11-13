import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { StoreBrand } from './types';

interface BrandShowcaseProps {
  locale: string;
  brands: StoreBrand[];
}

export default async function BrandShowcase({ locale, brands }: BrandShowcaseProps) {
  const t = await getTranslations({ locale, namespace: 'homepage.producerShowcase' });

  return (
    <section id="brands" className="border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-roh-military-olive mb-2">
              {t('eyebrow')}
            </div>
            <h2 className="font-display text-3xl font-bold text-foreground">
              {t('title')}
            </h2>
          </div>
          <Link
            href={`/${locale}/brands`}
            className="hidden sm:inline-flex items-center justify-center h-12 px-6 rounded-full border border-border bg-background text-foreground font-semibold hover:bg-card transition-colors"
            aria-label={t('viewAll')}
          >
            {t('viewAll')}
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
          {brands.length === 0
            ? [1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="bg-card border border-border rounded-2xl p-4 flex flex-col items-center justify-center gap-2"
                >
                  <div className="h-12 w-full bg-muted-foreground/10 rounded" />
                  <div className="h-4 w-24 bg-muted-foreground/10 rounded" />
                </div>
              ))
            : brands.map((brand) => (
                <article
                  key={brand.id}
                  className="bg-card border border-border rounded-2xl p-4 flex flex-col items-center justify-center gap-2 text-center"
                  aria-label={brand.name}
                >
                  {brand.logo_url ? (
                    <div className="h-12 w-full relative">
                      <Image
                        src={brand.logo_url}
                        alt={`${brand.name} logo`}
                        fill
                        className="object-contain"
                        unoptimized
                      />
                    </div>
                  ) : (
                    <div className="h-12 w-full flex items-center justify-center text-xs text-muted-foreground border border-border rounded">
                      {brand.name}
                    </div>
                  )}
                  <h3 className="font-bold text-sm text-foreground">{brand.name}</h3>
                  <Link
                    href={`/${locale}/brands/${brand.slug}`}
                    className="text-xs text-roh-flag-green underline hover:no-underline"
                    aria-label={`${t('seeMore')} ${brand.name}`}
                  >
                    {t('seeMore')}
                  </Link>
                </article>
              ))}
        </div>

        <div className="mt-6 sm:hidden flex justify-center">
          <Link
            href={`/${locale}/brands`}
            className="inline-flex items-center justify-center h-12 px-6 rounded-full border border-border bg-background text-foreground font-semibold"
            aria-label={t('viewAll')}
          >
            {t('viewAll')}
          </Link>
        </div>
      </div>
    </section>
  );
}
