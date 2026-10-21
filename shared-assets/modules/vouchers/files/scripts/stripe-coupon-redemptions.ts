/**
 * Fetch all redemptions of a Stripe promotion code and print a summary.
 *
 * Usage:
 *   npx tsx scripts/stripe-coupon-redemptions.ts
 *
 * Optional: filter by a specific promo code name/id:
 *   PROMO_CODE=WELCOME10 npx tsx scripts/stripe-coupon-redemptions.ts
 */

import Stripe from "stripe";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  typescript: true,
  apiVersion: "2026-01-28.clover",
});

const TARGET_CODE = process.env.PROMO_CODE ?? null; // e.g. "WELCOME10"

interface Redemption {
  sessionId: string;
  paymentIntentId: string | null;
  customerEmail: string | null;
  amountTotal: number;
  currency: string;
  discountAmount: number;
  promoCode: string;
  couponName: string;
  createdAt: Date;
}

async function main() {
  console.log("Fetching promotion codes from Stripe...\n");

  // 1. List all promo codes (paginated)
  const promoCodes: Stripe.PromotionCode[] = [];
  for await (const pc of stripe.promotionCodes.list({ limit: 100, expand: ["data.coupon"] })) {
    promoCodes.push(pc);
  }

  const target = TARGET_CODE
    ? promoCodes.filter((pc) => pc.code.toLowerCase() === TARGET_CODE.toLowerCase())
    : promoCodes;

  if (target.length === 0) {
    console.log(TARGET_CODE ? `No promo code found matching "${TARGET_CODE}".` : "No promo codes found.");
    return;
  }

  console.log(`Found ${target.length} promo code(s):\n`);
  for (const pc of target) {
    const coupon = pc.coupon as Stripe.Coupon;
    const discount = coupon.percent_off
      ? `${coupon.percent_off}% off`
      : `€${((coupon.amount_off ?? 0) / 100).toFixed(2)} off`;
    console.log(`  ${pc.code}  —  ${coupon.name ?? coupon.id}  (${discount})  times_redeemed: ${pc.times_redeemed}`);
  }
  console.log();

  // 2. For each promo code, find all checkout sessions that used it
  const redemptions: Redemption[] = [];

  for (const pc of target) {
    const coupon = pc.coupon as Stripe.Coupon;
    console.log(`Scanning completed sessions for code "${pc.code}"...`);

    for await (const session of stripe.checkout.sessions.list({
      limit: 100,
      status: "complete",
      expand: ["data.total_details.breakdown"],
    })) {
      const discounts = (session.total_details as any)?.breakdown?.discounts ?? [];
      const match = discounts.find(
        (d: any) =>
          d.discount?.promotion_code === pc.id ||
          d.discount?.coupon?.id === coupon.id
      );
      if (!match) continue;

      redemptions.push({
        sessionId: session.id,
        paymentIntentId: session.payment_intent as string | null,
        customerEmail: session.customer_details?.email ?? null,
        amountTotal: session.amount_total ?? 0,
        currency: session.currency ?? "eur",
        discountAmount: match.amount ?? 0,
        promoCode: pc.code,
        couponName: coupon.name ?? coupon.id,
        createdAt: new Date(session.created * 1000),
      });
    }
  }

  if (redemptions.length === 0) {
    console.log("\nNo redemptions found.");
    return;
  }

  // 3. Sort by date descending
  redemptions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // 4. Print table
  console.log(`\n${"─".repeat(100)}`);
  console.log(
    `${"Date".padEnd(22)}${"Email".padEnd(36)}${"Code".padEnd(14)}${"Discount".padEnd(12)}${"Total".padEnd(12)}Session`
  );
  console.log(`${"─".repeat(100)}`);

  for (const r of redemptions) {
    const date = r.createdAt.toISOString().slice(0, 19).replace("T", " ");
    const email = (r.customerEmail ?? "—").slice(0, 34);
    const discount = `-€${(r.discountAmount / 100).toFixed(2)}`;
    const total = `€${(r.amountTotal / 100).toFixed(2)}`;
    console.log(
      `${date.padEnd(22)}${email.padEnd(36)}${r.promoCode.padEnd(14)}${discount.padEnd(12)}${total.padEnd(12)}${r.sessionId}`
    );
  }

  console.log(`${"─".repeat(100)}`);
  console.log(`\nTotal redemptions: ${redemptions.length}`);
  const totalDiscount = redemptions.reduce((s, r) => s + r.discountAmount, 0);
  console.log(`Total discount given: €${(totalDiscount / 100).toFixed(2)}`);

  // 5. CSV export
  const csv = [
    "date,email,promo_code,coupon_name,discount_eur,total_eur,session_id,payment_intent_id",
    ...redemptions.map((r) =>
      [
        r.createdAt.toISOString(),
        r.customerEmail ?? "",
        r.promoCode,
        r.couponName,
        (r.discountAmount / 100).toFixed(2),
        (r.amountTotal / 100).toFixed(2),
        r.sessionId,
        r.paymentIntentId ?? "",
      ].join(",")
    ),
  ].join("\n");

  const outPath = path.resolve(__dirname, "../docs/stripe-coupon-redemptions.csv");
  const fs = await import("fs");
  fs.writeFileSync(outPath, csv);
  console.log(`\nCSV saved to: docs/stripe-coupon-redemptions.csv`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
