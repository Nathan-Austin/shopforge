import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { Category, StoreBrand } from '@/components/store/types';
import { requireShopOwner } from '../../lib/auth';
import ProductForm, { type ProductFormProduct } from '../../components/ProductForm';
import { updateProduct } from '../../actions/updateProduct';
import { deleteProduct } from '../../actions/deleteProduct';

interface ProductPageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditProductPage({ params }: ProductPageProps) {
  const { locale, id } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin' });

  const { data: productRow, error: productError } = await supabase
    .from('products')
    .select(
      `
      id,
      name,
      slug,
      price_cents,
      currency,
      description,
      details,
      image_url,
      category_id,
      brand_id,
      capacity_ml,
      ingredients,
      nutrition_info,
      is_active,
      size_options,
      color_options
    `
    )
    .eq('id', id)
    .maybeSingle();

  if (productError || !productRow) {
    notFound();
  }

  const [{ data: categoriesData }, { data: brandsData }] = await Promise.all([
    supabase.from('categories').select('id, name, slug').order('name'),
    supabase.from('brands').select('id, name, slug').order('name')
  ]);

  const categories: Category[] =
    categoriesData?.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug
    })) ?? [];
  const brands: StoreBrand[] =
    brandsData?.map((brand) => ({
      id: brand.id,
      name: brand.name,
      slug: brand.slug
    })) ?? [];

  const product: ProductFormProduct = {
    id: productRow.id,
    name: productRow.name,
    slug: productRow.slug,
    price_cents: productRow.price_cents,
    currency: productRow.currency,
    description: productRow.description,
    details: productRow.details,
    image_url: productRow.image_url,
    category_id: productRow.category_id,
    brand_id: productRow.brand_id,
    capacity_ml: productRow.capacity_ml,
    ingredients: productRow.ingredients,
    nutrition_info: productRow.nutrition_info,
    is_active: productRow.is_active,
    size_options: productRow.size_options,
    color_options: productRow.color_options
  };

  const defaultBrandId = brands[0]?.id;
  const updateAction = updateProduct.bind(null, { locale, defaultBrandId });
  const deleteAction = deleteProduct.bind(null, { locale });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{t('products.editProduct')}</h2>
        <p className="text-sm text-text-muted">{product.name}</p>
      </div>

      <ProductForm
        product={product}
        categories={categories}
        brands={brands}
        onSubmit={updateAction}
        onDelete={deleteAction}
        successRedirectPath={`/${locale}/admin/products`}
      />
    </div>
  );
}
