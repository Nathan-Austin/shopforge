"use server";

import { revalidatePath } from "next/cache";
import { ensureShopOwner } from "../lib/auth";

export async function reinstateProduct(productId: string, locale: string): Promise<{ error?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) return { error: "Not authorized" };

  const { error: updateError } = await supabase
    .from("products")
    .update({ is_archived: false })
    .eq("id", productId);

  if (updateError) return { error: updateError.message };

  revalidatePath(`/${locale}/admin/products`);
  revalidatePath(`/${locale}/admin/products/archived`);
  revalidatePath(`/${locale}/admin`);
  return {};
}
