"use server";

import { revalidatePath } from "next/cache";
import { ensureShopOwner } from "../lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/emails/client";
import { getShippingConfirmationHtml, getRefundConfirmationHtml } from "@/lib/emails/templates";
import { getStripeServerClient } from "@/lib/stripe/server";

type OrderStatus = "pending" | "paid" | "shipped" | "cancelled" | "refunded" | "partially_refunded";

export type Carrier = "postnl" | "bpost" | "dhl" | "dpd" | "other";

export type RefundInput =
  | { mode: "items"; items: { orderItemId: string; quantity: number }[]; reason?: string; idempotencyKey: string; confirmed: boolean }
  | { mode: "custom"; amountCents: number; reason?: string; idempotencyKey: string; confirmed: boolean };

function getTrackingUrl(
  carrier: Carrier,
  trackingNumber: string,
  shippingCountry?: string | null,
  shippingPostalCode?: string | null,
): string | null {
  switch (carrier) {
    case "postnl": {
      const barcode = encodeURIComponent(trackingNumber);
      if (shippingCountry && shippingPostalCode) {
        const country = shippingCountry.toUpperCase();
        const zip = shippingPostalCode.replace(/\s/g, "").toUpperCase();
        return `https://tracking.postnl.nl/track-and-trace/${barcode}-${country}-${zip}`;
      }
      return `https://tracking.postnl.nl/track-and-trace/${barcode}`;
    }
    case "bpost":
      return `https://track.bpost.cloud/btr/web/#/search?itemCode=${encodeURIComponent(trackingNumber)}&lang=en`;
    case "dhl":
      return `https://www.dhl.com/be-en/home/tracking.html?tracking-id=${encodeURIComponent(trackingNumber)}`;
    case "dpd":
      return `https://www.dpd.com/be/en/receiving-a-parcel/tracking/?parcelCode=${encodeURIComponent(trackingNumber)}`;
    default:
      return null;
  }
}

export async function updateOrderStatus(orderId: string, status: OrderStatus) {
  const { error: authError } = await ensureShopOwner();
  if (authError) return { error: authError ?? "Forbidden" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", orderId);

  if (error) return { error: error.message };

  revalidatePath("/[locale]/admin/orders", "page");
  revalidatePath("/[locale]/admin/orders/[id]", "page");
  return { error: null };
}

export async function markOrderShipped(
  orderId: string,
  trackingNumber: string,
  carrier: Carrier
) {
  const { error: authError, supabase } = await ensureShopOwner();
  if (authError || !supabase) return { error: authError ?? "Forbidden" };

  // Fetch full order + items for the email (session client is fine for reads)
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", orderId)
    .single();

  if (fetchError || !order) return { error: fetchError?.message ?? "Order not found" };

  const trackingUrl = trackingNumber
    ? getTrackingUrl(carrier, trackingNumber, order.shipping_country, order.shipping_postal_code)
    : null;

  // Use admin client to bypass RLS for the write
  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("orders")
    .update({
      status: "shipped",
      tracking_number: trackingNumber || null,
      tracking_carrier: carrier,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (updateError) return { error: updateError.message };

  // Send shipping confirmation email to customer
  const items = ((order.order_items as any[]) ?? []).map((item: any) => ({
    name: item.product_name,
    quantity: item.quantity,
    priceCents: item.price_cents,
    imageUrl: item.image_url ?? undefined,
  }));

  const firstName = (order.shipping_name ?? "").split(" ")[0] || "there";

  const emailResult = await sendEmail({
    to: order.customer_email,
    subject: `Your order #${order.order_number ? String(order.order_number).padStart(4, "0") : orderId.slice(0, 8).toUpperCase()} is on its way!`,
    html: getShippingConfirmationHtml({
      firstName,
      orderNumber: order.order_number ?? null,
      orderId,
      items,
      totalCents: order.total_cents,
      currency: order.currency ?? "EUR",
      shippingName: order.shipping_name ?? "",
      shippingStreet: order.shipping_street ?? "",
      shippingPostalCode: order.shipping_postal_code ?? "",
      shippingCity: order.shipping_city ?? "",
      shippingCountry: order.shipping_country ?? "",
      trackingNumber: trackingNumber || null,
      trackingCarrier: carrier,
      trackingUrl,
    }),
  });

  revalidatePath("/[locale]/admin/orders", "page");
  revalidatePath("/[locale]/admin/orders/[id]", "page");

  return {
    error: null,
    emailSent: emailResult.success,
  };
}

export async function refundOrder(orderId: string, input: RefundInput) {
  const { error: authError, supabase, user } = await ensureShopOwner();
  if (authError || !supabase || !user) return { error: authError ?? "Forbidden" };

  if (!input.confirmed) return { error: "Refund was not confirmed." };

  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", orderId)
    .single();

  if (fetchError || !order) return { error: fetchError?.message ?? "Order not found" };

  if (!order.stripe_payment_intent_id) {
    return { error: "This order has no Stripe payment to refund." };
  }

  const remainingCents = order.total_cents - (order.refunded_cents ?? 0);
  if (remainingCents <= 0) {
    return { error: "This order has already been fully refunded." };
  }

  const orderItems = (order.order_items as any[]) ?? [];
  let amountCents: number;
  const refundedItemsSnapshot: { orderItemId: string; name: string; quantity: number }[] = [];

  if (input.mode === "items") {
    if (!input.items.length) return { error: "Select at least one item to refund." };

    // Guard against refunding more of an item than was ordered, or more than
    // is left after earlier partial refunds already took some of it.
    const { data: priorRefunds } = await supabase
      .from("order_refunds")
      .select("items")
      .eq("order_id", orderId);

    const alreadyRefundedQty = new Map<string, number>();
    for (const refund of priorRefunds ?? []) {
      for (const item of (refund.items as { orderItemId: string; quantity: number }[] | null) ?? []) {
        alreadyRefundedQty.set(item.orderItemId, (alreadyRefundedQty.get(item.orderItemId) ?? 0) + item.quantity);
      }
    }

    const itemsById = new Map(orderItems.map((it) => [it.id as string, it]));
    let total = 0;
    for (const { orderItemId, quantity } of input.items) {
      const item = itemsById.get(orderItemId);
      if (!item) return { error: "Invalid item selected." };
      if (!Number.isInteger(quantity) || quantity < 1) {
        return { error: `Invalid quantity for ${item.product_name}.` };
      }
      const remainingQty = item.quantity - (alreadyRefundedQty.get(orderItemId) ?? 0);
      if (quantity > remainingQty) {
        return { error: `Can't refund ${quantity}x ${item.product_name} -- only ${remainingQty} unit(s) left to refund.` };
      }
      total += item.price_cents * quantity;
      refundedItemsSnapshot.push({ orderItemId, name: item.product_name, quantity });
    }
    amountCents = total;
  } else {
    if (!Number.isInteger(input.amountCents) || input.amountCents < 1) {
      return { error: "Enter a valid refund amount." };
    }
    amountCents = input.amountCents;
  }

  if (amountCents > remainingCents) {
    return { error: `Refund amount exceeds the ${(remainingCents / 100).toFixed(2)} ${order.currency} still refundable on this order.` };
  }

  const stripe = getStripeServerClient();
  let refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: order.stripe_payment_intent_id,
        amount: amountCents,
        metadata: { order_id: orderId, reason: input.reason ?? "" },
      },
      { idempotencyKey: input.idempotencyKey },
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Stripe refund failed." };
  }

  const newRefundedCents = (order.refunded_cents ?? 0) + amountCents;
  const newStatus: OrderStatus = newRefundedCents >= order.total_cents ? "refunded" : "partially_refunded";

  // Use admin client to bypass RLS for the write
  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("orders")
    .update({
      refunded_cents: newRefundedCents,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (updateError) return { error: updateError.message };

  const { error: insertError } = await admin.from("order_refunds").insert({
    order_id: orderId,
    stripe_refund_id: refund.id,
    amount_cents: amountCents,
    reason: input.reason || null,
    items: input.mode === "items" ? refundedItemsSnapshot : null,
    created_by: user.id,
  });
  if (insertError) console.error("[refundOrder] Failed to record refund audit row:", insertError);

  const orderRef = order.order_number ? String(order.order_number).padStart(4, "0") : orderId.slice(0, 8).toUpperCase();
  const firstName = (order.shipping_name ?? "").split(" ")[0] || "there";

  const emailResult = await sendEmail({
    to: order.customer_email,
    subject: `Refund processed for your order #${orderRef}`,
    html: getRefundConfirmationHtml({
      firstName,
      orderNumber: order.order_number,
      orderId,
      amountCents,
      currency: order.currency ?? "EUR",
      isFullRefund: newStatus === "refunded",
      refundedItems:
        input.mode === "items" ? refundedItemsSnapshot.map((i) => ({ name: i.name, quantity: i.quantity })) : undefined,
    }),
  });

  revalidatePath("/[locale]/admin/orders", "page");
  revalidatePath("/[locale]/admin/orders/[id]", "page");

  return {
    error: null,
    amountCents,
    newStatus,
    emailSent: emailResult.success,
  };
}
