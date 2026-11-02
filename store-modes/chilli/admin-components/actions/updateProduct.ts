'use server';

import { revalidatePath } from 'next/cache';
import { parseProductFields } from '@/lib/products/catalogue';
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
  const price = Number(formData.get('price'));
  const currency = formData.get('currency')?.toString().trim() || 'EUR';
  const categoryId = formData.get('category_id')?.toString() || null;
  const brandId =
    formData.get('brand_id')?.toString() ||
    (context.defaultBrandId ? String(context.defaultBrandId) : null);
  const imageUrl = formData.get('image_url')?.toString() || null;
  const chilliTypeIds = formData
    .getAll('chilliTypeIds')
    .map((id) => id.toString())
    .filter(Boolean);

  if (!name || !slug || !Number.isFinite(price)) {
    return { error: 'Missing required fields' };
  }

  if (storeMode === 'multi' && !brandId) {
    return { error: 'Brand is required in multi-store mode' };
  }

  // Everything the shop enabled in src/lib/products/config.ts.
  const fields = parseProductFields(formData);

  const { error: updateError } = await supabase
    .from('products')
    .update({
      ...fields,
      name,
      slug,
      price_cents: Math.round(price * 100),
      currency,
      image_url: imageUrl,
      category_id: categoryId,
      brand_id: brandId,
      updated_at: new Date().toISOString()
    })
    .eq('id', productId);

  if (updateError) {
    return { error: updateError.message };
  }

  // The form always submits the full selection, so replace the links.
  await supabase.from('products_chilli_types').delete().eq('product_id', productId);

  if (chilliTypeIds.length > 0) {
    const rows = chilliTypeIds.map((chilliId) => ({
      product_id: productId,
      chilli_type_id: chilliId
    }));
    const { error: insertError } = await supabase
      .from('products_chilli_types')
      .insert(rows);
    if (insertError) {
      return { error: insertError.message };
    }
  }

  revalidatePath(`/${context.locale}/admin/products`);
  revalidatePath(`/${context.locale}/admin/products/${productId}`);

  return { success: 'updated' };
}
