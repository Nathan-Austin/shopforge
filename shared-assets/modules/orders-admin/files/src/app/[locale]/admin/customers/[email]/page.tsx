import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { requireShopOwner } from "../../lib/auth";
import { formatPrice } from "@/lib/format";
import { ArrowLeft, Mail, Package, ShoppingBag, Gift } from "lucide-react";

const STATUS_STYLES: Record<string, string> = {
  paid:               "bg-green-50 text-green-700 border-green-200",
  shipped:            "bg-blue-50 text-blue-700 border-blue-200",
  cancelled:          "bg-red-50 text-red-600 border-red-200",
  refunded:           "bg-orange-50 text-orange-700 border-orange-200",
  partially_refunded: "bg-orange-50 text-orange-700 border-orange-200",
  pending:            "bg-zinc-50 text-zinc-500 border-zinc-200",
};
const STATUS_LABELS: Record<string, string> = { shipped: "Completed", partially_refunded: "Partially Refunded" };

type CustomerOrder = {
  id: string;
  orderRef: string;
  href: string;
  name: string | null;
  total_cents: number;
  currency: string;
  status: string;
  date: string;
  items: { name: string; quantity: number; image_url: string | null }[];
};

export default async function CustomerHistoryPage({
  params,
}: {
  params: Promise<{ locale: string; email: string }>;
}) {
  const { locale, email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail);
  const { supabase } = await requireShopOwner(locale);

  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, shipping_name, total_cents, currency, status, created_at, order_items(product_name, image_url, quantity)")
    .ilike("customer_email", email)
    .order("created_at", { ascending: false });

  if (!orders?.length) notFound();

  const allOrders: CustomerOrder[] = (orders ?? []).map((o) => ({
    id: o.id,
    orderRef: o.order_number ? String(o.order_number).padStart(4, "0") : o.id.slice(0, 8).toUpperCase(),
    href: `/${locale}/admin/orders/${o.id}`,
    name: o.shipping_name,
    total_cents: o.total_cents,
    currency: o.currency,
    status: o.status,
    date: o.created_at,
    items: ((o.order_items ?? []) as { product_name: string; quantity: number; image_url: string | null }[]).map((it) => ({
      name: it.product_name,
      quantity: it.quantity,
      image_url: it.image_url,
    })),
  }));

  const displayName = allOrders.find((o) => o.name)?.name ?? email;
  const currency = allOrders[0]?.currency ?? "EUR";
  const lifetimeCents = allOrders.reduce((sum, o) => sum + o.total_cents, 0);

  // Aggregate every product they've ever ordered -- the whole point of this
  // page is letting the owner see what a customer already liked, e.g. when
  // someone wants to buy that person a gift.
  const productMap = new Map<string, { name: string; image_url: string | null; totalQuantity: number; orderedTimes: number }>();
  for (const order of allOrders) {
    for (const item of order.items) {
      const existing = productMap.get(item.name);
      if (existing) {
        existing.totalQuantity += item.quantity;
        existing.orderedTimes += 1;
        if (!existing.image_url && item.image_url) existing.image_url = item.image_url;
      } else {
        productMap.set(item.name, {
          name: item.name,
          image_url: item.image_url,
          totalQuantity: item.quantity,
          orderedTimes: 1,
        });
      }
    }
  }
  const products = Array.from(productMap.values()).sort((a, b) => b.totalQuantity - a.totalQuantity);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href={`/${locale}/admin/orders`}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-400 hover:text-brand-red transition-colors mb-4"
        >
          <ArrowLeft size={13} />
          Back to Orders
        </Link>

        <div className="flex items-center gap-3">
          <div className="bg-zinc-100 p-2 rounded-lg">
            <Mail size={20} className="text-zinc-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">{displayName}</h1>
            <a href={`mailto:${email}`} className="text-sm text-brand-red hover:underline">
              {email}
            </a>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-1">Total Orders</p>
          <p className="text-2xl font-bold text-zinc-900">{allOrders.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-1">Lifetime Spend</p>
          <p className="text-2xl font-bold text-zinc-900">{formatPrice(lifetimeCents, currency)}</p>
        </div>
      </div>

      {/* Previously ordered products */}
      {products.length > 0 && (
        <div className="rounded-xl border border-border bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center gap-2">
            <Gift size={15} className="text-zinc-500" />
            <h2 className="font-bold text-sm text-zinc-900">Previously Ordered ({products.length})</h2>
          </div>
          <div className="divide-y divide-zinc-100">
            {products.map((p) => (
              <div key={p.name} className="px-5 py-3 flex items-center gap-4">
                {p.image_url ? (
                  <Image
                    src={p.image_url}
                    alt={p.name}
                    width={40}
                    height={40}
                    className="rounded-lg object-contain bg-zinc-50 border border-zinc-100 shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-zinc-100 shrink-0 flex items-center justify-center text-base">
                    🌶️
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-zinc-900 truncate">{p.name}</p>
                  <p className="text-xs text-zinc-400">
                    Ordered {p.orderedTimes} time{p.orderedTimes !== 1 ? "s" : ""} · {p.totalQuantity} total
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Order history */}
      <div className="rounded-xl border border-border bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center gap-2">
          <Package size={15} className="text-zinc-500" />
          <h2 className="font-bold text-sm text-zinc-900">Order History ({allOrders.length})</h2>
        </div>
        <div className="divide-y divide-zinc-100">
          {allOrders.map((order) => (
            <Link
              key={order.id}
              href={order.href}
              className="group flex items-center justify-between gap-4 px-5 py-4 hover:bg-zinc-50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="bg-zinc-100 p-1.5 rounded text-zinc-500 shrink-0">
                  <ShoppingBag size={13} />
                </div>
                <div className="min-w-0">
                  <p className="font-mono font-bold text-sm text-zinc-900">#{order.orderRef}</p>
                  <p className="text-xs text-zinc-400">
                    {new Date(order.date).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${STATUS_STYLES[order.status] ?? STATUS_STYLES.pending}`}>
                  {STATUS_LABELS[order.status] ?? order.status}
                </span>
                <p className="font-bold text-sm text-zinc-900 w-20 text-right">
                  {formatPrice(order.total_cents, order.currency)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
