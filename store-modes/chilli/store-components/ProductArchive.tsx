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
import { formatHeat, heatScale } from '@/lib/products/heat';
import type { StoreProduct, ChilliType, Category } from './types';
import ProductCard from './ProductCard';
import Chip from './Chip';

/** Sorts this store mode offers, including the heat sorts. */
export const ARCHIVE_SORT_OPTIONS: ArchiveSort[] = [
  'recent',
  'popular',
  'mild-first',
  'hot-first'
];

const PAGE_SIZE = 12;

// Heat is stored as a number; the filter buttons are the shop's word bands.
const HEAT_WORDS = heatScale?.bands.map((band) => band.word) ?? [];

interface ProductArchiveProps {
  products: StoreProduct[];
  chilliTypes: ChilliType[];
  categories: Category[];
  locale: string;
  /** Parsed server-side from the page's searchParams. */
  initialQuery: ArchiveQuery;
}

/**
 * The /shop listing: search, heat, chilli type and category filters and
 * sorting over products the server already fetched. The state lives in the
 * URL (?q=…&heat=…&type=…&category=…&sort=…) so results can be shared and
 * survive a reload; updates go through history.replaceState, so typing
 * never re-runs the server page.
 */
export default function ProductArchive({
  products,
  chilliTypes,
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
    () => sortArchive(filterArchive(products, query, heatScale), query.sort),
    [products, query]
  );

  const selectedCategory = useMemo(
    () => categories.find((category) => category.slug === query.category) ?? null,
    [categories, query.category]
  );

  const selectedPepper = useMemo(
    () => chilliTypes.find((type) => type.slug === query.chilliType) ?? null,
    [chilliTypes, query.chilliType]
  );

  const clearAllFilters = () =>
    update({ search: '', heat: '', chilliType: '', category: '' });

  const displayed = filtered.slice(0, displayCount);
  const hasMore = filtered.length > displayCount;
  const chipCount =
    Number(Boolean(query.heat)) +
    Number(Boolean(selectedCategory)) +
    Number(Boolean(selectedPepper));

  return (
    <div className="py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Filter Section */}
        <section className="border-b border-border pb-5 mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Search */}
            <label className="block text-sm font-medium text-foreground">
              {t('search.placeholder')}
              <input
                type="search"
                placeholder={t('search.placeholder')}
                value={query.search}
                onChange={(e) => update({ search: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground
                         focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
            </label>

            {/* Heat Level - Button Chips */}
            <fieldset>
              <legend className="block text-sm font-medium text-foreground">
                {t('search.filters.heatLevel')}
              </legend>
              <div className="mt-1 flex flex-wrap gap-2 items-center">
                {HEAT_WORDS.map((word) => (
                  <button
                    key={word}
                    type="button"
                    aria-pressed={query.heat === word}
                    onClick={() => update({ heat: query.heat === word ? '' : word })}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors
                      ${query.heat === word
                        ? 'bg-emerald-700 text-stone-50 border-emerald-700'
                        : 'border-border bg-card text-foreground hover:border-emerald-700 hover:bg-emerald-700/10'
                      }`}
                  >
                    {word}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Pepper */}
            <label className="block text-sm font-medium text-foreground">
              {t('search.filters.pepper')}
              <select
                value={query.chilliType}
                onChange={(e) => update({ chilliType: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground
                         focus:outline-none focus:ring-2 focus:ring-emerald-700"
              >
                <option value="">{t('search.filters.allChilliTypes')}</option>
                {chilliTypes.map((chilliType) => (
                  <option key={chilliType.id} value={chilliType.slug}>
                    {chilliType.name}
                  </option>
                ))}
              </select>
            </label>

            {/* Category */}
            <label className="block text-sm font-medium text-foreground">
              {t('search.filters.sauceType')}
              <select
                value={query.category}
                onChange={(e) => update({ category: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground
                         focus:outline-none focus:ring-2 focus:ring-emerald-700"
              >
                <option value="">{t('search.filters.allCategories')}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            {/* Sort */}
            <label className="block text-sm font-medium text-foreground">
              {t('search.filters.sort')}
              <select
                value={query.sort}
                onChange={(e) => update({ sort: e.target.value as ArchiveSort })}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground
                         focus:outline-none focus:ring-2 focus:ring-emerald-700"
              >
                <option value="recent">{t('search.filters.sortNewest')}</option>
                <option value="popular">{t('search.filters.sortPopular')}</option>
                <option value="mild-first">{t('search.filters.sortMildToHot')}</option>
                <option value="hot-first">{t('search.filters.sortHotToMild')}</option>
              </select>
            </label>
          </div>

          {/* Active Filter Chips */}
          {chipCount > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 items-center">
              {selectedPepper && (
                <Chip variant="filter" onRemove={() => update({ chilliType: '' })}>
                  {selectedPepper.name}
                  {selectedPepper.heatLevel ? ` • ${formatHeat(selectedPepper.heatLevel)}` : ''}
                </Chip>
              )}
              {query.heat && (
                <Chip variant="filter" onRemove={() => update({ heat: '' })}>
                  {t('search.filters.heatChip', { value: query.heat })}
                </Chip>
              )}
              {selectedCategory && (
                <Chip variant="filter" onRemove={() => update({ category: '' })}>
                  {t('search.filters.categoryChip', { value: selectedCategory.name })}
                </Chip>
              )}
              {chipCount > 1 && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-xs font-medium text-foreground underline-offset-4 hover:text-emerald-700 hover:underline"
                >
                  {t('results.clearFilters')}
                </button>
              )}
            </div>
          )}

          {/* Results Count */}
          <div className="mt-3 text-sm text-text-muted">
            {t('results.showingCount', { shown: displayed.length, total: filtered.length })}
          </div>
        </section>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🌶️</div>
            <h3 className="text-xl font-bold text-foreground mb-4">{t('results.noResults')}</h3>
            <p className="text-text-muted">
              {t('results.adjustSearch')}
            </p>
            <button
              type="button"
              onClick={clearAllFilters}
              className="mt-4 px-4 py-2 rounded-lg border border-border bg-card text-foreground
                       transition-colors hover:border-emerald-700 hover:bg-emerald-700/10"
            >
              {t('results.clearFilters')}
            </button>
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

        {/* Load More */}
        {hasMore && (
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={() => setDisplayCount((prev) => prev + PAGE_SIZE)}
              className="px-4 py-2 rounded-lg border border-border bg-card text-foreground
                       transition-colors font-medium hover:border-emerald-700 hover:bg-emerald-700/10"
            >
              {t('results.loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
