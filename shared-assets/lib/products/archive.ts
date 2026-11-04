/**
 * Shop archive: URL query parsing, filtering and sorting.
 *
 * The /shop page keeps its search, filters and sort in the URL so results
 * can be shared, bookmarked and survive a reload. Everything here is a pure
 * function over plain data: the ProductArchive components call these and
 * only own the wiring (state, inputs, history.replaceState).
 *
 * Heat is matched by its display word rather than the number, because the
 * filter buttons the customer sees are the shop's heat-scale bands.
 */

import { heatWordOn, type HeatScale } from './heat';

export const ARCHIVE_SORTS = ['recent', 'popular', 'mild-first', 'hot-first'] as const;
export type ArchiveSort = (typeof ARCHIVE_SORTS)[number];

export const DEFAULT_ARCHIVE_SORT: ArchiveSort = 'recent';

/**
 * "Popular" ranks by units sold, so it means nothing in a shop that has
 * barely sold anything: with three orders the sort is noise. The option is
 * hidden (and rejected from the URL) until the shop has sold this many
 * units in the last 90 days (the product_sales view's rolling window). A
 * store that imports its recent order history clears the bar on day one.
 */
export const POPULARITY_MIN_UNITS = 100;

export function popularityAvailable(unitsSold: number): boolean {
  return Number.isFinite(unitsSold) && unitsSold >= POPULARITY_MIN_UNITS;
}

/** The sorts to offer: the mode's list, minus "popular" until it means something. */
export function availableSorts(
  modeSorts: readonly ArchiveSort[],
  unitsSold: number
): ArchiveSort[] {
  return modeSorts.filter((sort) => sort !== 'popular' || popularityAvailable(unitsSold));
}

/** The archive's whole state. Empty string means "not filtering by this". */
export interface ArchiveQuery {
  search: string;
  /** Category slug. */
  category: string;
  /** Heat band word, e.g. "Hot". Only meaningful in chilli shops. */
  heat: string;
  /** Chilli type slug. Only meaningful in chilli shops. */
  chilliType: string;
  sort: ArchiveSort;
}

export const EMPTY_ARCHIVE_QUERY: ArchiveQuery = {
  search: '',
  category: '',
  heat: '',
  chilliType: '',
  sort: DEFAULT_ARCHIVE_SORT
};

/** The URL parameter for each query field: /shop?q=…&category=…&sort=… */
export const ARCHIVE_PARAMS = {
  search: 'q',
  category: 'category',
  heat: 'heat',
  chilliType: 'type',
  sort: 'sort'
} as const;

type SearchParamValues = string | string[] | undefined;

function first(value: SearchParamValues): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/**
 * Reads the archive state out of a page's `searchParams`. Repeated
 * parameters collapse to the first value and an unknown sort falls back to
 * the default, so a mistyped or stale URL still renders rather than crashing.
 * Sorts the mode doesn't offer (heat sorts in a generic shop) are rejected
 * the same way via `allowedSorts`.
 */
export function parseArchiveQuery(
  params: Record<string, SearchParamValues>,
  allowedSorts: readonly ArchiveSort[] = ARCHIVE_SORTS
): ArchiveQuery {
  const sort = first(params[ARCHIVE_PARAMS.sort]) as ArchiveSort;
  return {
    search: first(params[ARCHIVE_PARAMS.search]),
    category: first(params[ARCHIVE_PARAMS.category]),
    heat: first(params[ARCHIVE_PARAMS.heat]),
    chilliType: first(params[ARCHIVE_PARAMS.chilliType]),
    sort: allowedSorts.includes(sort) ? sort : DEFAULT_ARCHIVE_SORT
  };
}

/**
 * The query string for a state, with defaults left out so the bare /shop
 * URL stays bare. Returns "" when nothing is set, "?q=…" otherwise.
 */
export function archiveQueryString(query: ArchiveQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set(ARCHIVE_PARAMS.search, query.search);
  if (query.category) params.set(ARCHIVE_PARAMS.category, query.category);
  if (query.heat) params.set(ARCHIVE_PARAMS.heat, query.heat);
  if (query.chilliType) params.set(ARCHIVE_PARAMS.chilliType, query.chilliType);
  if (query.sort !== DEFAULT_ARCHIVE_SORT) params.set(ARCHIVE_PARAMS.sort, query.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** What filtering and sorting need to know about a product. */
export interface ArchiveProduct {
  name: string;
  description?: string | null;
  brand?: { name: string } | null;
  category?: { id: string | number; slug: string } | null;
  chilliTypes?: { id: string | number; slug?: string }[];
  heatLevel?: string | number | null;
  /** Units sold, from the product_sales view; what "popular" sorts by. */
  salesCount?: number | null;
  /** ISO timestamp; what "newest" sorts by. */
  createdAt?: string | null;
}

function matchesSearch(product: ArchiveProduct, term: string): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  return [product.name, product.description, product.brand?.name].some((haystack) =>
    haystack?.toLowerCase().includes(needle)
  );
}

function matchesCategory(product: ArchiveProduct, category: string): boolean {
  if (!category) return true;
  return (
    product.category?.slug === category || product.category?.id?.toString() === category
  );
}

function matchesHeat(
  product: ArchiveProduct,
  heat: string,
  scale: HeatScale | null
): boolean {
  if (!heat) return true;
  return heatWordOn(scale, product.heatLevel) === heat;
}

function matchesChilliType(product: ArchiveProduct, chilliType: string): boolean {
  if (!chilliType) return true;
  return (product.chilliTypes ?? []).some(
    (type) => type.slug === chilliType || type.id?.toString() === chilliType
  );
}

/** Products matching every active filter, in their incoming order. */
export function filterArchive<T extends ArchiveProduct>(
  products: readonly T[],
  query: ArchiveQuery,
  scale: HeatScale | null = null
): T[] {
  return products.filter(
    (product) =>
      matchesSearch(product, query.search) &&
      matchesCategory(product, query.category) &&
      matchesHeat(product, query.heat, scale) &&
      matchesChilliType(product, query.chilliType)
  );
}

function toTime(value: string | null | undefined): number {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function toHeat(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * A sorted copy.
 *
 * - recent: newest first by createdAt.
 * - popular: most units sold first (see POPULARITY_MIN_UNITS for when the
 *   option is offered at all), ties broken by newest.
 * - mild-first / hot-first: by heat level, products without one last either
 *   way, ties broken by newest.
 */
export function sortArchive<T extends ArchiveProduct>(
  products: readonly T[],
  sort: ArchiveSort
): T[] {
  const byNewest = (a: T, b: T) => toTime(b.createdAt) - toTime(a.createdAt);

  const sorted = [...products];
  switch (sort) {
    case 'popular':
      return sorted.sort(
        (a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0) || byNewest(a, b)
      );
    case 'mild-first':
      return sorted.sort((a, b) => {
        const aHeat = toHeat(a.heatLevel);
        const bHeat = toHeat(b.heatLevel);
        return (
          (aHeat ?? Number.POSITIVE_INFINITY) - (bHeat ?? Number.POSITIVE_INFINITY) ||
          byNewest(a, b)
        );
      });
    case 'hot-first':
      return sorted.sort((a, b) => {
        const aHeat = toHeat(a.heatLevel);
        const bHeat = toHeat(b.heatLevel);
        return (
          (bHeat ?? Number.NEGATIVE_INFINITY) - (aHeat ?? Number.NEGATIVE_INFINITY) ||
          byNewest(a, b)
        );
      });
    case 'recent':
    default:
      return sorted.sort(byNewest);
  }
}

/**
 * Only offer filter options that lead somewhere. A category or chilli type
 * with no published product would be a one-click route to "no matches".
 */
export function categoriesInUse<C extends { id: string | number; slug: string }>(
  categories: readonly C[],
  products: readonly ArchiveProduct[]
): C[] {
  const used = new Set<string>();
  for (const product of products) {
    if (product.category) {
      used.add(product.category.slug);
      used.add(product.category.id.toString());
    }
  }
  return categories.filter(
    (category) => used.has(category.slug) || used.has(category.id.toString())
  );
}

export function chilliTypesInUse<T extends { id: string | number; slug: string }>(
  chilliTypes: readonly T[],
  products: readonly ArchiveProduct[]
): T[] {
  const used = new Set<string>();
  for (const product of products) {
    for (const type of product.chilliTypes ?? []) {
      if (type.slug) used.add(type.slug);
      used.add(type.id.toString());
    }
  }
  return chilliTypes.filter((type) => used.has(type.slug) || used.has(type.id.toString()));
}
