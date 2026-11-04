import { getTranslations } from 'next-intl/server';

import { maxAllowedQuantity } from '@/lib/cart/pricing';
import { availableSorts, parseArchiveQuery } from '@/lib/products/archive';
import { many } from '@/lib/supabase/relations';
import { createClient } from '@/lib/supabase/server';
import ProductArchive, { ARCHIVE_SORT_OPTIONS } from './ProductArchive';
import type { StoreProduct, Category, ChilliType } from './types';

/**
 * Server half of the /shop archive: fetches the catalogue and the filter
 * options, parses the URL state, and hands both to the client component.
 * The page itself stays one file for every store mode; this component is
 * the mode-specific part, which in a chilli shop means heat levels and
 * each product's chilli types for the heat and pepper filters.
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
  heat_level: number | null;
  created_at: string | null;
}

interface ChilliTypeRow {
  id: string;
  name: string;
  slug: string;
  heat_level: number | null;
}

export default async function ShopArchive({ locale, searchParams }: ShopArchiveProps) {
  const supabase = await createClient();

  // products_public is the storefront view: published, unarchived rows
  // with no supplier fields. The chilli-type links come from their own
  // world-readable tables, in one query for the whole catalogue.
  const [
    { data: productRows },
    { data: categoryRows },
    { data: chilliTypeRows },
    { data: linkRows },
    { data: salesRows }
  ] = await Promise.all([
    supabase
      .from('products_public')
      .select(
        'id, name, slug, description, image_url, price_cents, currency, stock, track_inventory, allow_backorder, max_order_quantity, size_options, color_options, category_id, category_name, category_slug, brand_id, brand_name, brand_slug, heat_level, created_at'
      )
      .order('created_at', { ascending: false }),
    supabase.from('categories').select('id, name, slug').order('name'),
    supabase.from('chilli_types').select('id, name, slug, heat_level').order('name'),
    supabase
      .from('products_chilli_types')
      .select('product_id, chilli_types ( id, name, slug, heat_level )'),
    // Units sold per product (an aggregate view, no order data). Drives the
    // "popular" sort, which stays hidden until the shop has sold enough for
    // it to mean anything.
    supabase.from('product_sales').select('product_id, units_sold')
  ]);

  const salesByProduct = new Map<string, number>();
  let unitsSold = 0;
  for (const row of (salesRows ?? []) as { product_id: string; units_sold: number }[]) {
    salesByProduct.set(row.product_id, row.units_sold);
    unitsSold += row.units_sold;
  }
  const sortOptions = availableSorts(ARCHIVE_SORT_OPTIONS, unitsSold);

  const chilliTypes: ChilliType[] = ((chilliTypeRows ?? []) as ChilliTypeRow[]).map(
    (row) => ({ id: row.id, name: row.name, slug: row.slug, heatLevel: row.heat_level })
  );

  const typesByProduct = new Map<string, ChilliType[]>();
  for (const link of linkRows ?? []) {
    const productId = (link as { product_id: string }).product_id;
    for (const row of many(
      (link as { chilli_types: ChilliTypeRow | ChilliTypeRow[] | null }).chilli_types
    )) {
      const list = typesByProduct.get(productId) ?? [];
      list.push({ id: row.id, name: row.name, slug: row.slug, heatLevel: row.heat_level });
      typesByProduct.set(productId, list);
    }
  }

  const products: StoreProduct[] = ((productRows ?? []) as ProductRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    image_url: row.image_url,
    price_cents: row.price_cents,
    currency: row.currency,
    heatLevel: row.heat_level,
    chilliTypes: typesByProduct.get(row.id) ?? [],
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

  const categories: Category[] = (categoryRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug
  }));

  // A shop with nothing in it yet gets a plain note, not search controls
  // and a "no matches" message that suggest the customer did something.
  if (products.length === 0) {
    const t = await getTranslations({ locale, namespace: 'Shop' });
    return <p className="py-8 text-gray-600">{t('empty')}</p>;
  }

  return (
    <ProductArchive
      products={products}
      chilliTypes={chilliTypes}
      categories={categories}
      locale={locale}
      initialQuery={parseArchiveQuery(searchParams, sortOptions)}
      sortOptions={sortOptions}
    />
  );
}
