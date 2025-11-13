'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { StoreProduct, Category } from './types';
import ProductCard from './ProductCard';

type SortOption = 'recent' | 'popular';

interface ProductArchiveProps {
  products: StoreProduct[];
  categories: Category[];
  locale: string;
}

export default function ProductArchive({ products, categories, locale }: ProductArchiveProps) {
  const t = useTranslations('SauceArchive');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [displayCount, setDisplayCount] = useState(12);

  const filtered = useMemo(() => {
    let list = products.filter((product) => {
      const matchesSearch = !searchTerm
        || product.name.toLowerCase().includes(searchTerm.toLowerCase())
        || product.description?.toLowerCase().includes(searchTerm.toLowerCase())
        || product.brand?.name?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCategory =
        !selectedCategory ||
        product.category?.id?.toString() === selectedCategory ||
        product.category?.slug === selectedCategory;

      return matchesSearch && matchesCategory;
    });

    if (sortBy === 'popular') {
      list = [...list];
    } else {
      list = [...list];
    }

    return list;
  }, [products, searchTerm, selectedCategory, sortBy]);

  const displayed = filtered.slice(0, displayCount);
  const hasMore = filtered.length > displayCount;

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
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-roh-flag-green"
              />
            </label>

            <label className="block text-sm font-medium text-foreground">
              {t('search.filters.sauceType')}
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-roh-flag-green"
              >
                <option value="">{t('search.filters.allCategories')}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-foreground">
              {t('search.filters.sort')}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-roh-flag-green"
              >
                <option value="recent">{t('search.filters.sortNewest')}</option>
                <option value="popular">{t('search.filters.sortPopular')}</option>
              </select>
            </label>

            {(searchTerm || selectedCategory) && (
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedCategory('');
                  }}
                  className="text-sm font-semibold text-roh-flag-green underline"
                >
                  {t('results.clearFilters')}
                </button>
              </div>
            )}
          </div>

          <div className="mt-3 text-sm text-text-muted">
            {t('results.showing')} {displayed.length} {t('results.of')} {filtered.length}
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
              <ProductCard key={product.id} product={product} locale={locale} />
            ))}
          </div>
        )}

        {hasMore && (
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={() => setDisplayCount((prev) => prev + 12)}
              className="px-4 py-2 rounded-lg border border-border bg-card text-foreground transition-colors font-medium hover:border-roh-flag-green hover:bg-roh-flag-green/10"
            >
              {t('results.loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
