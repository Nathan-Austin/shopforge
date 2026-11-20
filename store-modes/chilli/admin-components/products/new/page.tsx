import { getTranslations } from 'next-intl/server';
import type { Category, ChilliType, StoreBrand } from '@/components/store/types';
import { requireShopOwner } from '../../lib/auth';
import { enabledProductFieldGroupsFrom } from '@/lib/products/catalogue';
import { getHeatScale, getProductFieldKeys, getShopCurrency, getShopMode } from '@/lib/settings/store';
import ProductForm from '../../components/ProductForm';
import { createProduct } from '../../actions/createProduct';

export default async function NewProductPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin' });

  const [{ data: categoriesData }, { data: chilliTypesData }, { data: brandsData }] = await Promise.all([
    supabase.from('categories').select('id, name, slug').order('name'),
    supabase.from('chilli_types').select('id, name, slug, heat_level').order('name'),
    supabase.from('brands').select('id, name, slug').order('name')
  ]);

  const categories: Category[] =
    categoriesData?.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug
    })) ?? [];
  const chilliTypes: ChilliType[] =
    chilliTypesData?.map((ct) => ({
      id: ct.id,
      name: ct.name,
      slug: ct.slug,
      heatLevel: ct.heat_level
    })) ?? [];
  const brands: StoreBrand[] =
    brandsData?.map((brand) => ({
      id: brand.id,
      name: brand.name,
      slug: brand.slug
    })) ?? [];

  const defaultBrandId = brands[0]?.id;
  const createAction = createProduct.bind(null, { locale, defaultBrandId });

  // The fields this shop manages, as saved under Admin → Settings.
  const fieldGroups = enabledProductFieldGroupsFrom(await getProductFieldKeys(), await getShopMode());
  const heatScale = await getHeatScale();
  const currency = await getShopCurrency();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{t('products.newProduct')}</h2>
        <p className="text-sm text-text-muted">{t('form.createDescription')}</p>
      </div>

      <ProductForm
        fieldGroups={fieldGroups}
        heatScale={heatScale}
        currency={currency}
        categories={categories}
        chilliTypes={chilliTypes}
        brands={brands}
        onSubmit={createAction}
        successRedirectPath={`/${locale}/admin/products`}
      />
    </div>
  );
}
