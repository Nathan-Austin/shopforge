import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { StoreProduct } from '@/components/store/types';
import { requireShopOwner } from '../lib/auth';

export default async function ProductsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);
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

  const products: StoreProduct[] =
    data?.map((row: any) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      price_cents: row.price_cents,
      currency: row.currency,
      heatLevel: row.heat_level,
      image_url: row.image_url,
      brand: row.brand
        ? {
            id: row.brand.id,
            name: row.brand.name,
            slug: row.brand.slug || ''
          }
        : null,
      category: row.category
        ? {
            id: row.category.id,
            name: row.category.name,
            slug: row.category.slug || ''
          }
        : null
    })) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t('products.heading')}</h2>
          <p className="text-sm text-text-muted">{t('products.subheading')}</p>
        </div>
        <Link
          href={`/${locale}/admin/products/new`}
          className="inline-flex items-center rounded-full bg-roh-flag-green px-4 py-2 text-sm font-semibold text-white"
        >
          {t('products.newProduct')}
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-roh-dust-white text-left text-sm font-semibold text-text-secondary">
            <tr>
              <th className="px-4 py-3">{t('products.name')}</th>
              <th className="px-4 py-3">{t('products.category')}</th>
              <th className="px-4 py-3">{t('products.brand')}</th>
              <th className="px-4 py-3">{t('products.heat')}</th>
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
                <td className="px-4 py-3">{product.heatLevel || '—'}</td>
                <td className="px-4 py-3 font-semibold">
                  {(product.price_cents / 100).toLocaleString(locale, {
                    style: 'currency',
                    currency: product.currency
                  })}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/${locale}/admin/products/${product.id}`}
                    className="text-sm font-semibold text-roh-flag-green hover:underline"
                  >
                    {t('products.edit')}
                  </Link>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
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
