'use server';

import { revalidatePath } from 'next/cache';
import { ensureShopOwner } from '../lib/auth';

interface DeleteProductContext {
  locale: string;
}

export async function deleteProduct(
  context: DeleteProductContext,
  formData: FormData
): Promise<{ error?: string; success?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) {
    return { error: 'Not authorized' };
  }

  const productId = formData.get('product_id')?.toString();
  if (!productId) {
    return { error: 'Missing product ID' };
  }

  const { error: deleteError } = await supabase.from('products').delete().eq('id', productId);
  if (deleteError) {
    return { error: deleteError.message };
  }

  revalidatePath(`/${context.locale}/admin/products`);

  return { success: 'deleted' };
}
