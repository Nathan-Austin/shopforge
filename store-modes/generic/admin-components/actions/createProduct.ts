'use server';

import { revalidatePath } from 'next/cache';
import { parseProductFields } from '@/lib/products/catalogue';
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
  // Entered in major units and stored as cents, like every other money field.
  const price = Number(formData.get('price'));
  const currency = formData.get('currency')?.toString().trim() || 'EUR';
  const categoryId = formData.get('category_id')?.toString() || null;
  const brandId =
    formData.get('brand_id')?.toString() ||
    (context.defaultBrandId ? String(context.defaultBrandId) : null);
  const imageUrl = formData.get('image_url')?.toString() || null;

  if (!name || !slug || !Number.isFinite(price)) {
    return { error: 'Missing required fields' };
  }

  if (storeMode === 'multi' && !brandId) {
    return { error: 'Brand is required in multi-store mode' };
  }

  // Everything the shop enabled in src/lib/products/config.ts.
  const fields = parseProductFields(formData);

  const { data: product, error: insertError } = await supabase
    .from('products')
    .insert({
      ...fields,
      name,
      slug,
      price_cents: Math.round(price * 100),
      currency,
      image_url: imageUrl,
      category_id: categoryId,
      brand_id: brandId
    })
    .select('id')
    .single();

  if (insertError || !product) {
    return { error: insertError?.message || 'Unable to create product' };
  }

  revalidatePath(`/${context.locale}/admin/products`);

  return { success: 'created', productId: product.id };
}
