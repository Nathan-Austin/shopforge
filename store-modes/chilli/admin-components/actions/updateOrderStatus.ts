'use server';

import { revalidatePath } from 'next/cache';
import { ensureShopOwner } from '../lib/auth';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/orders/service';

interface UpdateOrderStatusContext {
  locale: string;
}

/**
 * Records a new status on an order. The database function re-checks that
 * the caller is the shop owner, so this action is a thin wrapper. Changing
 * the status to "refunded" does not refund anything in Stripe yet.
 */
export async function updateOrderStatus(
  context: UpdateOrderStatusContext,
  formData: FormData
): Promise<{ error?: string; success?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) {
    return { error: 'Not authorized' };
  }

  const orderId = formData.get('order_id')?.toString();
  const status = formData.get('status')?.toString() as OrderStatus | undefined;
  if (!orderId || !status || !ORDER_STATUSES.includes(status)) {
    return { error: 'Missing order or status' };
  }

  const { error: rpcError } = await supabase.rpc('set_order_status', {
    p_order_id: orderId,
    p_status: status
  });
  if (rpcError) {
    return { error: rpcError.message };
  }

  revalidatePath(`/${context.locale}/admin/orders`);
  revalidatePath(`/${context.locale}/account/orders`);

  return { success: 'updated' };
}
