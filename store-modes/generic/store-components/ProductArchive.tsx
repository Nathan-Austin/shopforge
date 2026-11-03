'use client';

import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import AddToCartButton from '@/components/cart/AddToCartButton';
import {
  archiveQueryString,
  filterArchive,
  sortArchive,
  type ArchiveQuery,
  type ArchiveSort
} from '@/lib/products/archive';
import type { StoreProduct, Category } from './types';
import ProductCard from './ProductCard';

/** Sorts this store mode offers; the heat sorts are chilli-only. */
export const ARCHIVE_SORT_OPTIONS: ArchiveSort[] = ['recent', 'popular'];

const PAGE_SIZE = 12;

interface ProductArchiveProps {
  products: StoreProduct[];
  categories: Category[];
  locale: string;
  /** Parsed server-side from the page's searchParams. */
  initialQuery: ArchiveQuery;
}

/**
 * The /shop listing: search, category filter and sort over products the
 * server already fetched. The state lives in the URL (?q=…&category=…&sort=…)
 * so results can be shared and survive a reload; updates go through
 * history.replaceState, so typing never re-runs the server page.
 */
export default function ProductArchive({
  products,
  categories,
  locale,
  initialQuery
}: ProductArchiveProps) {
  const t = useTranslations('SauceArchive');
  const pathname = usePathname();
  const [query, setQuery] = useState<ArchiveQuery>(initialQuery);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  const update = (changes: Partial<ArchiveQuery>) => {
    const next = { ...query, ...changes };
    setQuery(next);
    // A new filter means a new result list, so start its paging over.
    setDisplayCount(PAGE_SIZE);
    window.history.replaceState(null, '', `${pathname}${archiveQueryString(next)}`);
  };

  const filtered = useMemo(
    () => sortArchive(filterArchive(products, query), query.sort),
    [products, query]
  );

  const displayed = filtered.slice(0, displayCount);
  const hasMore = filtered.length > displayCount;
  const hasFilters = Boolean(query.search || query.category);

  return (
    <div className="py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <section className="border-b border-border pb-5 mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="block text-sm font-medium text-foreground">
              {t('search.placeholder')}
              <input
                type="search"
                placeholder={t('search.placeholder')}
                value={query.search}
                onChange={(e) => update({ search: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
            </label>

            <label className="block text-sm font-medium text-foreground">
              {t('search.filters.sauceType')}
              <select
                value={query.category}
                onChange={(e) => update({ category: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-700"
              >
                <option value="">{t('search.filters.allCategories')}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-foreground">
              {t('search.filters.sort')}
              <select
                value={query.sort}
                onChange={(e) => update({ sort: e.target.value as ArchiveSort })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-700"
              >
                <option value="recent">{t('search.filters.sortNewest')}</option>
                <option value="popular">{t('search.filters.sortPopular')}</option>
              </select>
            </label>

            {hasFilters && (
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => update({ search: '', category: '' })}
                  className="text-sm font-semibold text-emerald-700 underline"
                >
                  {t('results.clearFilters')}
                </button>
              </div>
            )}
          </div>

          <div className="mt-3 text-sm text-text-muted">
            {t('results.showingCount', { shown: displayed.length, total: filtered.length })}
          </div>
        </section>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🛒</div>
            <h3 className="text-xl font-bold text-foreground mb-4">{t('results.noResults')}</h3>
            <p className="text-text-muted">{t('results.adjustSearch')}</p>
          </div>
        )}

        {displayed.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayed.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                locale={locale}
                action={
                  <AddToCartButton
                    locale={locale}
                    productId={product.id.toString()}
                    sizeOptions={product.sizeOptions}
                    colorOptions={product.colorOptions}
                    soldOut={product.soldOut}
                    className="w-full"
                  />
                }
              />
            ))}
          </div>
        )}

        {hasMore && (
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={() => setDisplayCount((prev) => prev + PAGE_SIZE)}
              className="px-4 py-2 rounded-lg border border-border bg-card text-foreground transition-colors font-medium hover:border-emerald-700 hover:bg-emerald-700/10"
            >
              {t('results.loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
