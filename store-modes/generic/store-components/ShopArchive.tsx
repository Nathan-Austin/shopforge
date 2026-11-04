import { getTranslations } from 'next-intl/server';

import { maxAllowedQuantity } from '@/lib/cart/pricing';
import {
  availableSorts,
  categoriesInUse,
  parseArchiveQuery,
  type ArchiveSort
} from '@/lib/products/archive';
import { createClient } from '@/lib/supabase/server';
import ProductArchive from './ProductArchive';
import type { StoreProduct, Category } from './types';

/**
 * Server half of the /shop archive: fetches the catalogue and the filter
 * options, parses the URL state, and hands both to the client component.
 * The page itself stays one file for every store mode; this component is
 * the mode-specific part (the chilli one also loads heat and chilli types).
 */
export interface ShopArchiveProps {
  locale: string;
  searchParams: Record<string, string | string[] | undefined>;
}

interface ProductRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  price_cents: number;
  currency: string;
  stock: number | null;
  track_inventory: boolean | null;
  allow_backorder: boolean | null;
  max_order_quantity: number | null;
  size_options: string[] | null;
  color_options: string[] | null;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  brand_id: string | null;
  brand_name: string | null;
  brand_slug: string | null;
  created_at: string | null;
}

/**
 * Sorts this store mode offers; the heat sorts are chilli-only.
 * "popular" is dropped by availableSorts() until the shop has enough sales
 * to rank. Defined here, not in ProductArchive: that file is 'use client',
 * and a server component importing a value from it gets a client reference,
 * not the array.
 */
const ARCHIVE_SORT_OPTIONS: ArchiveSort[] = ['recent', 'popular'];

export default async function ShopArchive({ locale, searchParams }: ShopArchiveProps) {
  const supabase = await createClient();

  // products_public is the storefront view: published, unarchived rows
  // with no supplier fields. Brand and category come pre-joined because
  // PostgREST cannot embed a relation through a view.
  const [{ data: productRows }, { data: categoryRows }, { data: salesRows }] =
    await Promise.all([
      supabase
        .from('products_public')
        .select(
          'id, name, slug, description, image_url, price_cents, currency, stock, track_inventory, allow_backorder, max_order_quantity, size_options, color_options, category_id, category_name, category_slug, brand_id, brand_name, brand_slug, created_at'
        )
        .order('created_at', { ascending: false }),
      supabase.from('categories').select('id, name, slug').order('name'),
      // Units sold per product (an aggregate view, no order data). Drives
      // the "popular" sort, which stays hidden until the shop has sold
      // enough for it to mean anything.
      supabase.from('product_sales').select('product_id, units_sold')
    ]);

  const salesByProduct = new Map<string, number>();
  let unitsSold = 0;
  for (const row of (salesRows ?? []) as { product_id: string; units_sold: number }[]) {
    salesByProduct.set(row.product_id, row.units_sold);
    unitsSold += row.units_sold;
  }
  const sortOptions = availableSorts(ARCHIVE_SORT_OPTIONS, unitsSold);

  const products: StoreProduct[] = ((productRows ?? []) as ProductRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    image_url: row.image_url,
    price_cents: row.price_cents,
    currency: row.currency,
    category: row.category_id
      ? {
          id: row.category_id,
          name: row.category_name ?? '',
          slug: row.category_slug ?? ''
        }
      : null,
    brand: row.brand_id
      ? { id: row.brand_id, name: row.brand_name ?? '', slug: row.brand_slug ?? '' }
      : null,
    salesCount: salesByProduct.get(row.id) ?? 0,
    createdAt: row.created_at,
    sizeOptions: row.size_options,
    colorOptions: row.color_options,
    soldOut:
      maxAllowedQuantity({
        stock: row.stock,
        trackInventory: row.track_inventory,
        allowBackorder: row.allow_backorder,
        maxOrderQuantity: row.max_order_quantity
      }) <= 0
  }));

  // Only options that lead to at least one product, so no filter is a
  // one-click route to "no matches".
  const categories: Category[] = categoriesInUse(
    (categoryRows ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug })),
    products
  );

  // A shop with nothing in it yet gets a plain note, not search controls
  // and a "no matches" message that suggest the customer did something.
  if (products.length === 0) {
    const t = await getTranslations({ locale, namespace: 'Shop' });
    return <p className="py-8 text-gray-600">{t('empty')}</p>;
  }

  return (
    <ProductArchive
      products={products}
      categories={categories}
      locale={locale}
      initialQuery={parseArchiveQuery(searchParams, sortOptions)}
      sortOptions={sortOptions}
    />
  );
}
