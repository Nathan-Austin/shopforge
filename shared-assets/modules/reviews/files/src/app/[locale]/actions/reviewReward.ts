"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/emails/client";
import { getReviewRewardHtml } from "@/lib/emails/templates";
import { createOneTimeDiscountCode } from "@/lib/vouchers/createOneTimeDiscountCode";

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Called after a review is successfully submitted. Grants a single-use 10%
 * discount code for the oldest not-yet-rewarded order that contains the
 * reviewed product, so multiple reviews from the same order only ever earn
 * one code. Best-effort — failures here must never surface as a review
 * submission error.
 */
export async function grantReviewDiscountIfEligible({
  productId,
}: {
  productId: string;
}): Promise<{ rewarded: boolean }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) return { rewarded: false };

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, shipping_name, order_items!inner(product_id)")
      .eq("user_id", user.id)
      .in("status", ["paid", "shipped"])
      .is("review_discount_sent_at", null)
      .eq("order_items.product_id", productId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!order) return { rewarded: false };

    const codeResult = await createOneTimeDiscountCode({
      email: user.email,
      source: "review_reward",
      orderId: order.id,
    });

    if ("error" in codeResult) {
      console.error("[ReviewReward] Failed to create discount code:", codeResult.error);
      return { rewarded: false };
    }

    const { success, error: emailError } = await sendEmail({
      to: user.email,
      subject: "Thanks for your review — here's 10% off 🌶️",
      html: getReviewRewardHtml({
        customerName: order.shipping_name?.split(" ")[0] || "there",
        voucherCode: codeResult.code,
      }),
    });

    if (!success) {
      console.error("[ReviewReward] Failed to send email:", emailError);
    }

    // Mark the order as rewarded regardless of email success so a retry
    // doesn't mint a second code for the same order.
    await supabaseAdmin
      .from("orders")
      .update({ review_discount_sent_at: new Date().toISOString() })
      .eq("id", order.id);

    return { rewarded: success };
  } catch (err) {
    console.error("[ReviewReward] Unexpected error:", err);
    return { rewarded: false };
  }
}
