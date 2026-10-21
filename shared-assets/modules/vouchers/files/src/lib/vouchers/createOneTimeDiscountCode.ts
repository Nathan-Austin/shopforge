import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { getStripeServerClient } from "@/lib/stripe/server";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function generateCode(): string {
  return `SPICY-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

/**
 * Creates a fresh Stripe coupon + a single-use (max_redemptions: 1) promotion
 * code, so each customer gets their own code instead of one shared string
 * that could leak and be reused indefinitely.
 */
export async function createOneTimeDiscountCode({
  email,
  source,
  orderId,
  percentOff = 10,
}: {
  email: string;
  source: "review_reminder" | "newsletter_welcome" | "review_reward";
  orderId?: string;
  percentOff?: number;
}): Promise<{ code: string } | { error: string }> {
  const stripe = getStripeServerClient();

  try {
    const coupon = await stripe.coupons.create({
      percent_off: percentOff,
      duration: "once",
      name: `${percentOff}% off (${source})`,
    });

    let code = generateCode();
    let promoCode;
    try {
      promoCode = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: coupon.id },
        code,
        active: true,
        max_redemptions: 1,
      });
    } catch (err: any) {
      // Extremely unlikely code collision — retry once with a new code.
      if (err?.code === "resource_already_exists") {
        code = generateCode();
        promoCode = await stripe.promotionCodes.create({
          promotion: { type: "coupon", coupon: coupon.id },
          code,
          active: true,
          max_redemptions: 1,
        });
      } else {
        throw err;
      }
    }

    const { error: insertError } = await supabaseAdmin
      .from("one_time_discount_codes")
      .insert({
        source,
        email: email.toLowerCase(),
        order_id: orderId ?? null,
        code,
        stripe_coupon_id: coupon.id,
        stripe_promo_code_id: promoCode.id,
      });

    if (insertError) throw insertError;

    return { code };
  } catch (err: any) {
    console.error("[Vouchers] Failed to create one-time discount code:", err);
    return { error: err?.message || "Failed to create discount code" };
  }
}
