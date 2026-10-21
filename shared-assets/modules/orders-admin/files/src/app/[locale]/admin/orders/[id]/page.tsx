import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { requireShopOwner } from "../../lib/auth";
import { formatPrice } from "@/lib/format";
import { ArrowLeft, Download, ExternalLink, Mail, MapPin, Package, ShoppingBag, Tag, Truck } from "lucide-react";
import { updateOrderStatus } from "../actions";
import ShipOrderForm from "./ShipOrderForm";
import RefundOrderForm from "./RefundOrderForm";

const STATUS_STYLES: Record<string, string> = {
  paid:               "bg-green-50 text-green-700 border-green-200",
  shipped:            "bg-blue-50 text-blue-700 border-blue-200",
  cancelled:          "bg-red-50 text-red-600 border-red-200",
  refunded:           "bg-orange-50 text-orange-700 border-orange-200",
  partially_refunded: "bg-orange-50 text-orange-700 border-orange-200",
  pending:            "bg-zinc-50 text-zinc-500 border-zinc-200",
};

// "partially_refunded"/"refunded" are set automatically by the refund flow
// (derived from refunded_cents vs total_cents) -- deliberately not a manual
// dropdown option here, to avoid it drifting out of sync with actual refunds.
const ALL_STATUSES = ["pending", "paid", "shipped", "cancelled", "refunded"] as const;
const STATUS_LABELS: Record<string, string> = { shipped: "Completed", partially_refunded: "Partially Refunded" };

const CARRIER_LABELS: Record<string, string> = {
  postnl: "PostNL",
  bpost: "bpost",
  dhl: "DHL",
  dpd: "DPD",
};

function getTrackingUrl(
  carrier: string,
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

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { supabase } = await requireShopOwner(locale);

  const { data: order } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", id)
    .single();

  if (!order) notFound();

  const { data: refunds } = await supabase
    .from("order_refunds")
    .select("id, amount_cents, reason, items, created_at")
    .eq("order_id", id)
    .order("created_at", { ascending: false });

  const alreadyRefundedQty = new Map<string, number>();
  for (const refund of refunds ?? []) {
    for (const item of (refund.items as { orderItemId: string; quantity: number }[] | null) ?? []) {
      alreadyRefundedQty.set(item.orderItemId, (alreadyRefundedQty.get(item.orderItemId) ?? 0) + item.quantity);
    }
  }

  const orderRef = order.order_number
    ? String(order.order_number).padStart(4, "0")
    : order.id.slice(0, 8).toUpperCase();

  const orderDate = new Date(order.created_at);
  const isShipped = order.status === "shipped";
  const isFinalised = order.status === "cancelled" || order.status === "refunded";
  const trackingUrl =
    (order as any).tracking_number && (order as any).tracking_carrier
      ? getTrackingUrl(
          (order as any).tracking_carrier,
          (order as any).tracking_number,
          order.shipping_country,
          order.shipping_postal_code,
        )
      : null;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back + header */}
      <div>
        <Link
          href={`/${locale}/admin/orders`}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-400 hover:text-brand-red transition-colors mb-4"
        >
          <ArrowLeft size={13} />
          Back to Orders
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="bg-zinc-100 p-2 rounded-lg">
              <ShoppingBag size={20} className="text-zinc-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-zinc-900">Order #{orderRef}</h1>
              <p className="text-sm text-zinc-400">
                {orderDate.toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                at{" "}
                {orderDate.toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`/api/admin/orders/${id}/packing-slip`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              <Download size={13} /> Packing Slip PDF
            </a>
            <span className={`text-xs font-bold uppercase px-3 py-1 rounded-full border ${STATUS_STYLES[order.status] ?? STATUS_STYLES.pending}`}>
              {STATUS_LABELS[order.status] ?? order.status}
            </span>
          </div>
        </div>
      </div>

      {/* Tracking info banner (when already shipped) */}
      {isShipped && (order as any).tracking_number && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Truck size={18} className="text-blue-600 shrink-0" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-500 mb-0.5">
                {CARRIER_LABELS[(order as any).tracking_carrier] ?? (order as any).tracking_carrier ?? "Carrier"}
              </p>
              <p className="font-mono font-bold text-sm text-blue-900">{(order as any).tracking_number}</p>
            </div>
          </div>
          {trackingUrl && (
            <a
              href={trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors shrink-0"
            >
              Track Parcel <ExternalLink size={12} />
            </a>
          )}
        </div>
      )}

      {/* Mark as Shipped form */}
      {!isFinalised && (
        <ShipOrderForm
          orderId={id}
          currentCarrier={(order as any).tracking_carrier}
          currentTrackingNumber={(order as any).tracking_number}
          isAlreadyShipped={isShipped}
        />
      )}

      {/* Refund (via Stripe) */}
      {order.stripe_payment_intent_id && (
        <RefundOrderForm
          orderId={id}
          currency={order.currency ?? "EUR"}
          totalCents={order.total_cents}
          refundedCents={(order as any).refunded_cents ?? 0}
          items={(order.order_items as any[]).map((item) => ({
            id: item.id,
            name: item.product_name,
            quantity: item.quantity,
            priceCents: item.price_cents,
            remainingQty: item.quantity - (alreadyRefundedQty.get(item.id) ?? 0),
          }))}
        />
      )}

      {/* Refund history */}
      {refunds && refunds.length > 0 && (
        <div className="rounded-xl border border-border bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100">
            <h2 className="font-bold text-sm text-zinc-900">Refund History ({refunds.length})</h2>
          </div>
          <div className="divide-y divide-zinc-100">
            {refunds.map((refund) => {
              const refundItems = (refund.items as { name: string; quantity: number }[] | null) ?? [];
              return (
                <div key={refund.id} className="px-5 py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-900">
                      {refundItems.length > 0
                        ? refundItems.map((it) => `${it.name} ×${it.quantity}`).join(", ")
                        : refund.reason || "Custom amount"}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {new Date(refund.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      {refundItems.length > 0 && refund.reason ? ` · ${refund.reason}` : ""}
                    </p>
                  </div>
                  <p className="font-bold text-sm text-orange-700 shrink-0">
                    -{formatPrice(refund.amount_cents, order.currency ?? "EUR")}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Update status (for cancellations / refunds / manual overrides) */}
      <div className="rounded-xl border border-border bg-white p-5">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-3">Update Status</h2>
        <form
          action={async (formData: FormData) => {
            "use server";
            const status = formData.get("status") as any;
            await updateOrderStatus(id, status);
            redirect(`/${locale}/admin/orders/${id}`);
          }}
          className="flex items-center gap-3 flex-wrap"
        >
          <select
            name="status"
            defaultValue={order.status}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red"
          >
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {STATUS_LABELS[s] ?? (s.charAt(0).toUpperCase() + s.slice(1))}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-zinc-900 text-white text-sm font-bold hover:bg-black transition-colors"
          >
            Save
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Customer */}
        <div className="rounded-xl border border-border bg-white p-5 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
            <Mail size={12} /> Customer
          </h2>
          <div className="space-y-1 text-sm">
            <Link
              href={`/${locale}/admin/customers/${encodeURIComponent(order.customer_email)}`}
              className="font-bold text-zinc-900 hover:text-brand-red hover:underline block w-fit"
            >
              {order.shipping_name || "—"}
            </Link>
            <a
              href={`mailto:${order.customer_email}`}
              className="text-brand-red hover:underline block"
            >
              {order.customer_email}
            </a>
          </div>
        </div>

        {/* Shipping address */}
        <div className="rounded-xl border border-border bg-white p-5 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
            <MapPin size={12} /> Shipping Address
          </h2>
          <div className="space-y-0.5 text-sm text-zinc-700">
            <p className="font-semibold">{order.shipping_name || "—"}</p>
            <p>{order.shipping_street || "—"}</p>
            <p>
              {[order.shipping_postal_code, order.shipping_city]
                .filter(Boolean)
                .join(" ") || "—"}
            </p>
            <p className="font-medium">{order.shipping_country || "—"}</p>
          </div>
        </div>
      </div>

      {/* Order items */}
      <div className="rounded-xl border border-border bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center gap-2">
          <Package size={15} className="text-zinc-500" />
          <h2 className="font-bold text-sm text-zinc-900">
            Items ({(order.order_items as any[]).length})
          </h2>
        </div>

        <div className="divide-y divide-zinc-100">
          {(order.order_items as any[]).map((item) => (
            <div key={item.id} className="px-5 py-4 flex items-center gap-4">
              {item.image_url ? (
                <Image
                  src={item.image_url}
                  alt={item.product_name}
                  width={44}
                  height={44}
                  className="rounded-lg object-contain bg-zinc-50 border border-zinc-100 shrink-0"
                />
              ) : (
                <div className="w-11 h-11 rounded-lg bg-zinc-100 shrink-0 flex items-center justify-center text-lg">
                  🌶️
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-zinc-900 truncate">{item.product_name}</p>
                {(item.selected_size || item.selected_color) && (
                  <p className="text-xs text-zinc-400">
                    {[item.selected_size, item.selected_color].filter(Boolean).join(" · ")}
                  </p>
                )}
                <p className="text-xs text-zinc-400">Qty: {item.quantity}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-sm text-zinc-900">
                  {formatPrice(item.price_cents * item.quantity, order.currency)}
                </p>
                {item.quantity > 1 && (
                  <p className="text-xs text-zinc-400">
                    {formatPrice(item.price_cents, order.currency)} each
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="px-5 py-4 border-t border-zinc-100 bg-zinc-50 space-y-2">
          <div className="flex justify-between text-sm text-zinc-600">
            <span>Subtotal</span>
            <span>{formatPrice(order.subtotal_cents, order.currency)}</span>
          </div>
          <div className="flex justify-between text-sm text-zinc-600">
            <span>Shipping</span>
            <span>{formatPrice(order.shipping_cents, order.currency)}</span>
          </div>
          {order.tax_cents > 0 && (
            <div className="flex justify-between text-sm text-zinc-600">
              <span>Tax</span>
              <span>{formatPrice(order.tax_cents, order.currency)}</span>
            </div>
          )}
          {order.voucher_code && (
            <div className="flex justify-between text-sm text-green-700">
              <span className="flex items-center gap-1">
                <Tag size={11} /> Voucher{" "}
                <span className="font-mono">{order.voucher_code}</span>
              </span>
              <span>
                {order.discount_cents > 0
                  ? `−${formatPrice(order.discount_cents, order.currency)}`
                  : "Applied"}
              </span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base text-zinc-900 pt-2 border-t border-zinc-200">
            <span>Total</span>
            <span>{formatPrice(order.total_cents, order.currency)}</span>
          </div>
        </div>
      </div>

      {/* Reference */}
      <div className="rounded-xl border border-border bg-white p-5">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-3">Order Reference</h2>
        <div className="space-y-2 text-xs text-zinc-500 font-mono">
          <div className="flex gap-2 flex-wrap">
            <span className="text-zinc-400 font-sans font-bold uppercase tracking-wider">Order ID</span>
            <span className="select-all">{order.id}</span>
          </div>
          {order.stripe_payment_intent_id && (
            <div className="flex gap-2 flex-wrap">
              <span className="text-zinc-400 font-sans font-bold uppercase tracking-wider">Stripe PI</span>
              <span className="select-all">{order.stripe_payment_intent_id}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
