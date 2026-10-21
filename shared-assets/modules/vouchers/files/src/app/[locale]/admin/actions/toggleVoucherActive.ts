"use server";

import { revalidatePath } from "next/cache";
import { ensureShopOwner } from "../lib/auth";
import { getStripeServerClient } from "@/lib/stripe/server";

export async function toggleVoucherActive(
  { locale }: { locale: string },
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) {
    return { error: "Not authorized" };
  }

  const voucherId = formData.get("voucher_id")?.toString();
  const nextActive = formData.get("next_active") === "true";

  if (!voucherId) {
    return { error: "Missing voucher id" };
  }

  const { data: voucher, error: fetchError } = await supabase
    .from("vouchers")
    .select("stripe_promo_code_id")
    .eq("id", voucherId)
    .single();

  if (fetchError || !voucher) {
    return { error: "Voucher not found" };
  }

  const stripe = getStripeServerClient();

  try {
    if (voucher.stripe_promo_code_id) {
      await stripe.promotionCodes.update(voucher.stripe_promo_code_id, {
        active: nextActive,
      });
    }

    const { error: updateError } = await supabase
      .from("vouchers")
      .update({ is_active: nextActive })
      .eq("id", voucherId);

    if (updateError) throw updateError;

    revalidatePath(`/${locale}/admin/vouchers`);
    return { success: "updated" };
  } catch (err: any) {
    console.error("[Voucher] Error toggling active state:", err);
    return { error: err.message || "Failed to update voucher" };
  }
}
