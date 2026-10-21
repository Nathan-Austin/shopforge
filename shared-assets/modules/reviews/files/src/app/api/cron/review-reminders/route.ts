import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/emails/client";
import { getReviewReminderHtml } from "@/lib/emails/templates";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://example.com";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: orders, error } = await supabaseAdmin
    .from("orders")
    .select("id, customer_email, shipping_name, created_at")
    .in("status", ["paid", "shipped"])
    .is("review_reminder_sent_at", null)
    .lte("created_at", new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.error("[Cron:ReviewReminders] Failed to fetch orders:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }

  console.log(`[Cron:ReviewReminders] ${orders?.length ?? 0} order(s) due for a reminder`);

  let sent = 0;
  let failed = 0;

  for (const order of orders ?? []) {
    try {
      const { data: items } = await supabaseAdmin
        .from("order_items")
        .select("product_name, image_url, product:products(slug, image_url)")
        .eq("order_id", order.id);

      const products = (items ?? []).map((item: any) => ({
        name: item.product_name,
        imageUrl: item.product?.image_url ?? item.image_url ?? null,
        slug: item.product?.slug ?? null,
      }));

      const reviewUrl = products[0]?.slug
        ? `${SITE_URL}/en/shop/${products[0].slug}#reviews`
        : `${SITE_URL}/en/shop`;

      const { success, error: emailError } = await sendEmail({
        to: order.customer_email,
        subject: "How was the heat? Leave a review & get 10% off 🌶️",
        html: getReviewReminderHtml({
          customerName: order.shipping_name?.split(" ")[0] || "there",
          products,
          reviewUrl,
        }),
      });

      if (!success) {
        console.error(`[Cron:ReviewReminders] Email send failed for order ${order.id}:`, emailError);
        failed++;
      } else {
        sent++;
      }
    } catch (err) {
      console.error(`[Cron:ReviewReminders] Error processing order ${order.id}:`, err);
      failed++;
    } finally {
      // Mark as handled regardless of email success so we don't retry-storm on a bad address
      await supabaseAdmin
        .from("orders")
        .update({ review_reminder_sent_at: new Date().toISOString() })
        .eq("id", order.id);
    }
  }

  return NextResponse.json({ processed: orders?.length ?? 0, sent, failed });
}
