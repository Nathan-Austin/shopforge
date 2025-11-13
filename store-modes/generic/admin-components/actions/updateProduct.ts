'use server';

import { revalidatePath } from 'next/cache';
import { ensureShopOwner } from '../lib/auth';

interface UpdateProductContext {
  locale: string;
  defaultBrandId?: string | number;
}

export async function updateProduct(
  context: UpdateProductContext,
  formData: FormData
): Promise<{ error?: string; success?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) {
    return { error: 'Not authorized' };
  }

  const storeMode = process.env.NEXT_PUBLIC_STORE_MODE === 'multi' ? 'multi' : 'single';
  const productId = formData.get('product_id')?.toString();
  if (!productId) {
    return { error: 'Missing product ID' };
  }

  const name = formData.get('name')?.toString().trim();
  const slug = formData.get('slug')?.toString().trim();
  const priceCents = Number(formData.get('price_cents'));
  const currency = formData.get('currency')?.toString() || 'GBP';
  const description = formData.get('description')?.toString() || '';
  const categoryId = formData.get('category_id')?.toString() || null;
  const brandId =
    formData.get('brand_id')?.toString() ||
    (context.defaultBrandId ? String(context.defaultBrandId) : null);
  const imageUrl = formData.get('image_url')?.toString() || null;

  if (!name || !slug || Number.isNaN(priceCents)) {
    return { error: 'Missing required fields' };
  }

  if (storeMode === 'multi' && !brandId) {
    return { error: 'Brand is required in multi-store mode' };
  }

  const { error: updateError } = await supabase
    .from('products')
    .update({
      name,
      slug,
      price_cents: priceCents,
      currency,
      description,
      image_url: imageUrl,
      category_id: categoryId,
      brand_id: brandId
    })
    .eq('id', productId);

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath(`/${context.locale}/admin/products`);
  revalidatePath(`/${context.locale}/admin/products/${productId}`);

  return { success: 'updated' };
}
