import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { PackingSlipDocument, type PackingSlipOrder } from "@/lib/pdf/PackingSlipDocument";
import { ensureShopOwner } from "@/app/[locale]/admin/lib/auth";
import { verifyPackingSlipToken } from "@/lib/security/orderAccessToken";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = req.nextUrl;
  const hasValidToken = verifyPackingSlipToken(id, searchParams.get("token"), searchParams.get("exp"));

  if (!hasValidToken) {
    const { error: authError, user } = await ensureShopOwner();
    if (authError || !user) {
      const status = authError === "UNAUTHENTICATED" ? 401 : 403;
      const message =
        authError === "MFA_REQUIRED"
          ? "Two-factor authentication required — please complete MFA verification and try again."
          : "Not authorized";
      return NextResponse.json({ error: message }, { status });
    }
  }

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", id)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const orderPayload: PackingSlipOrder = {
    id: order.id,
    orderNumber: order.order_number,
    customerEmail: order.customer_email,
    shippingName: order.shipping_name,
    shippingStreet: order.shipping_street,
    shippingCity: order.shipping_city,
    shippingPostalCode: order.shipping_postal_code,
    shippingCountry: order.shipping_country,
    subtotalCents: order.subtotal_cents,
    shippingCents: order.shipping_cents,
    totalCents: order.total_cents,
    currency: order.currency,
    voucherCode: order.voucher_code,
    orderedAt: new Date(order.created_at).toLocaleString("en-GB", {
      day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels",
    }),
    items: (order.order_items as any[]).map((item) => ({
      name: item.product_name,
      quantity: item.quantity,
      priceCents: item.price_cents,
      selectedSize: item.selected_size,
      selectedColor: item.selected_color,
      imageUrl: item.image_url,
    })),
  };

  const pdfBuffer = await renderToBuffer(
    createElement(PackingSlipDocument, { order: orderPayload }) as any,
  );
  const orderRef = order.order_number ?? order.id.slice(0, 8).toUpperCase();

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="packing-slip-${orderRef}.pdf"`,
    },
  });
}
