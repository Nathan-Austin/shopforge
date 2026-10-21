"use server";

import { revalidatePath } from "next/cache";
import { ensureShopOwner } from "../lib/auth";

export async function setAwayModeReturnDate(
  { locale }: { locale: string },
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  const { error, supabase, user } = await ensureShopOwner();
  if (error || !supabase || !user) {
    return { error: "Not authorized" };
  }

  const returnDate = formData.get("return_date")?.toString();
  if (!returnDate) {
    return { error: "Pick a return date" };
  }

  const today = new Date().toISOString().slice(0, 10);
  if (returnDate <= today) {
    return { error: "Return date must be in the future" };
  }

  const { error: updateError } = await supabase
    .from("away_mode")
    .update({
      return_date: returnDate,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath(`/${locale}/admin`);
  return { success: "set" };
}

// Restores full availability immediately: clears every tracked low-stock
// quantity and flips in_stock back to true -- including anything that
// auto-flipped to out-of-stock while a covering person's handed-off batch
// ran out. Used both for "I'm back early" and to cancel away mode outright,
// since in either case the right default is "fully available again until
// the owner says otherwise" -- see process_away_mode_return() (migration 0171)
// for why that's the correct default, not an accident.
export async function revertAwayModeNow(
  { locale }: { locale: string },
): Promise<{ error?: string; success?: string }> {
  const { error, supabase, user } = await ensureShopOwner();
  if (error || !supabase || !user) {
    return { error: "Not authorized" };
  }

  const { error: productsError } = await supabase
    .from("products")
    .update({ in_stock: true, low_stock_quantity: null })
    .or("low_stock_quantity.not.is.null,in_stock.eq.false");
  if (productsError) {
    return { error: productsError.message };
  }

  const { error: variantsError } = await supabase
    .from("product_variants")
    .update({ in_stock: true, low_stock_quantity: null })
    .or("low_stock_quantity.not.is.null,in_stock.eq.false");
  if (variantsError) {
    return { error: variantsError.message };
  }

  const { error: awayModeError } = await supabase
    .from("away_mode")
    .update({ return_date: null, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (awayModeError) {
    return { error: awayModeError.message };
  }

  revalidatePath(`/${locale}/admin`);
  revalidatePath(`/${locale}/admin/products`);
  revalidatePath("/", "layout");
  return { success: "reverted" };
}
