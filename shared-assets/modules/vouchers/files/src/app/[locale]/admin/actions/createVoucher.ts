"use server";

import { revalidatePath } from "next/cache";
import { ensureShopOwner } from "../lib/auth";
import { getStripeServerClient } from "@/lib/stripe/server";

interface CreateVoucherContext {
  locale: string;
}

export async function createVoucher(
  context: CreateVoucherContext,
  formData: FormData,
): Promise<{ error?: string; success?: string; voucherId?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) {
    return { error: "Not authorized" };
  }

  const name = formData.get("name")?.toString().trim();
  const code = formData.get("code")?.toString().trim().toUpperCase();
  const discountType = formData.get("discount_type")?.toString() as
    | "percentage"
    | "fixed";
  const amount = Number(formData.get("amount")); // percentage or cents
  const duration =
    (formData.get("duration")?.toString() as
      | "once"
      | "repeating"
      | "forever") || "once";
  const durationInMonths = formData.get("duration_in_months")
    ? Number(formData.get("duration_in_months"))
    : undefined;
  const maxRedemptions = formData.get("max_redemptions")
    ? Number(formData.get("max_redemptions"))
    : undefined;
  const firstTimeOnly = formData.get("first_time_only") === "true";
  const expiresAt = formData.get("expires_at")?.toString() || undefined;

  if (!name || !code || isNaN(amount)) {
    return { error: "Missing required fields" };
  }

  const stripe = getStripeServerClient();

  try {
    // 1. Create Coupon in Stripe
    const couponParams: any = {
      name: name,
      duration: duration,
      duration_in_months:
        duration === "repeating" ? durationInMonths : undefined,
    };

    if (discountType === "percentage") {
      couponParams.percent_off = amount;
    } else {
      couponParams.amount_off = amount;
      couponParams.currency = "eur";
    }

    const stripeCoupon = await stripe.coupons.create(couponParams);

    // 2. Create Promotion Code in Stripe
    const promoParams: any = {
      promotion: {
        type: "coupon",
        coupon: stripeCoupon.id,
      },
      code: code,
      active: true,
      restrictions: {
        first_time_transaction: firstTimeOnly,
      },
    };

    if (maxRedemptions) {
      promoParams.max_redemptions = maxRedemptions;
    }

    if (expiresAt) {
      promoParams.expires_at = Math.floor(new Date(expiresAt).getTime() / 1000);
    }

    const stripePromoCode = await stripe.promotionCodes.create(promoParams);

    // 3. Store in Supabase
    const { data: voucher, error: insertError } = await supabase
      .from("vouchers")
      .insert({
        name,
        code,
        stripe_coupon_id: stripeCoupon.id,
        stripe_promo_code_id: stripePromoCode.id,
        discount_type: discountType,
        amount,
        duration,
        duration_in_months: duration === "repeating" ? durationInMonths : null,
        max_redemptions: maxRedemptions || null,
        first_time_only: firstTimeOnly,
        expires_at: expiresAt || null,
        is_active: true,
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    revalidatePath(`/${context.locale}/admin/vouchers`);
    return { success: "created", voucherId: voucher.id };
  } catch (err: any) {
    console.error("[Voucher] Error creating stripe coupon/promo:", err);
    return { error: err.message || "Failed to create voucher" };
  }
}
