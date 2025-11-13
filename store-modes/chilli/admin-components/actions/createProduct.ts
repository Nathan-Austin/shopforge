'use server';

import { revalidatePath } from 'next/cache';
import { ensureShopOwner } from '../lib/auth';

interface CreateProductContext {
  locale: string;
  defaultBrandId?: string | number;
}

export async function createProduct(
  context: CreateProductContext,
  formData: FormData
): Promise<{ error?: string; success?: string; productId?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) {
    return { error: 'Not authorized' };
  }

  const storeMode = process.env.NEXT_PUBLIC_STORE_MODE === 'multi' ? 'multi' : 'single';
  const name = formData.get('name')?.toString().trim();
  const slug = formData.get('slug')?.toString().trim();
  const priceCents = Number(formData.get('price_cents'));
  const currency = formData.get('currency')?.toString() || 'GBP';
  const description = formData.get('description')?.toString() || '';
  const heatLevel = formData.get('heat_level')?.toString() || null;
  const categoryId = formData.get('category_id')?.toString() || null;
  const brandId =
    formData.get('brand_id')?.toString() ||
    (context.defaultBrandId ? String(context.defaultBrandId) : null);
  const imageUrl = formData.get('image_url')?.toString() || null;
  const chilliTypeIds = formData.getAll('chilliTypeIds').map((id) => id.toString()).filter(Boolean);

  if (!name || !slug || Number.isNaN(priceCents)) {
    return { error: 'Missing required fields' };
  }

  if (storeMode === 'multi' && !brandId) {
    return { error: 'Brand is required in multi-store mode' };
  }

  const { data: product, error: insertError } = await supabase
    .from('products')
    .insert({
      name,
      slug,
      price_cents: priceCents,
      currency,
      description,
      image_url: imageUrl,
      heat_level: heatLevel,
      category_id: categoryId,
      brand_id: brandId
    })
    .select('id')
    .single();

  if (insertError || !product) {
    return { error: insertError?.message || 'Unable to create product' };
  }

  if (chilliTypeIds.length > 0) {
    const joinRows = chilliTypeIds.map((chilliId) => ({
      product_id: product.id,
      chilli_type_id: chilliId
    }));
    const { error: joinError } = await supabase.from('products_chilli_types').insert(joinRows);
    if (joinError) {
      return { error: joinError.message };
    }
  }

  revalidatePath(`/${context.locale}/admin/products`);

  return { success: 'created', productId: product.id };
}
