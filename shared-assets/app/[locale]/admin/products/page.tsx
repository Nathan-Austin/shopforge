import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { one } from '@/lib/supabase/relations';
import { getShopMode } from '@/lib/settings/store';
import { requireShopOwner } from '../lib/auth';

/**
 * What the list shows. Its own type rather than the storefront's
 * StoreProduct: that one still differs between the store modes, and the
 * admin list needs nothing from it but these columns.
 */
interface ProductRow {
  id: string;
  name: string;
  slug: string;
  price_cents: number;
  currency: string;
  heatLevel: number | null;
  image_url: string | null;
  brand: { id: string; name: string; slug: string } | null;
  category: { id: string; name: string; slug: string } | null;
}

export default async function ProductsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);
  // Heat is a column in a chilli shop only; every shop stores it (0014).
  const showsHeat = (await getShopMode()) === 'chilli';
  const t = await getTranslations({ locale, namespace: 'Admin' });

  const { data } = await supabase
    .from('products')
    .select(
      `
      id,
      name,
      slug,
      price_cents,
      currency,
      heat_level,
      image_url,
      brand:brands ( id, name, slug ),
      category:categories ( id, name, slug )
    `
    )
    .order('created_at', { ascending: false });

  const products: ProductRow[] =
    data?.map((row) => {
      // Joined rows come back typed as arrays without generated database types
      const brand = one(row.brand);
      const category = one(row.category);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        price_cents: row.price_cents,
        currency: row.currency,
        heatLevel: row.heat_level,
        image_url: row.image_url,
        brand: brand
          ? {
              id: brand.id,
              name: brand.name,
              slug: brand.slug || ''
            }
          : null,
        category: category
          ? {
              id: category.id,
              name: category.name,
              slug: category.slug || ''
            }
          : null
      };
    }) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t('products.heading')}</h2>
          <p className="text-sm text-text-muted">{t('products.subheading')}</p>
        </div>
        <Link
          href={`/${locale}/admin/products/new`}
          className="inline-flex items-center rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
        >
          {t('products.newProduct')}
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-stone-50 text-left text-sm font-semibold text-text-secondary">
            <tr>
              <th className="px-4 py-3">{t('products.name')}</th>
              <th className="px-4 py-3">{t('products.category')}</th>
              <th className="px-4 py-3">{t('products.brand')}</th>
              {showsHeat && <th className="px-4 py-3">{t('products.heat')}</th>}
              <th className="px-4 py-3">{t('products.price')}</th>
              <th className="px-4 py-3 text-right">{t('products.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-sm">
            {products.map((product) => (
              <tr key={product.id}>
                <td className="px-4 py-3 font-medium text-foreground">{product.name}</td>
                <td className="px-4 py-3 text-text-muted">
                  {product.category?.name || t('form.notSet')}
                </td>
                <td className="px-4 py-3 text-text-muted">{product.brand?.name || '—'}</td>
                {showsHeat && <td className="px-4 py-3">{product.heatLevel || '—'}</td>}
                <td className="px-4 py-3 font-semibold">
                  {(product.price_cents / 100).toLocaleString(locale, {
                    style: 'currency',
                    currency: product.currency
                  })}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/${locale}/admin/products/${product.id}`}
                    className="text-sm font-semibold text-emerald-700 hover:underline"
                  >
                    {t('products.edit')}
                  </Link>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={showsHeat ? 6 : 5} className="px-4 py-6 text-center text-text-muted">
                  {t('products.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
