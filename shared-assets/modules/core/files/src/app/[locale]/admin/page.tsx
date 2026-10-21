import { getTranslations } from "next-intl/server";
import { requireShopOwner } from "./lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Package,
  ShoppingBag,
  AlertTriangle,
  Clock,
  ArrowRight,
  Star,
  Mail,
  BarChart3,
} from "lucide-react";
import AwayModeCard from "./components/AwayModeCard";
import { formatPrice } from "@/lib/format";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import Image from "next/image";

export default async function AdminDashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: "Admin" });

  const [
    { count: productCount },
    { count: brandCount },
    { count: categoryCount },
    { data: recentOrders },
    { data: lowStockProducts },
    { data: soldItems },
    { count: reviewCount },
    { data: awayModeRow },
  ] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("brands").select("id", { count: "exact", head: true }),
    supabase.from("categories").select("id", { count: "exact", head: true }),
    supabase
      .from("orders")
      .select("id, order_number, customer_email, total_cents, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("products")
      .select("name, in_stock, low_stock_quantity, low_stock_threshold")
      .eq("is_archived", false)
      .or("in_stock.eq.false,low_stock_quantity.not.is.null")
      .order("low_stock_quantity", { ascending: true, nullsFirst: true })
      .limit(200),
    supabase
      .from("order_items")
      .select("product_id, product_name, image_url, quantity, price_cents, orders!inner(status)")
      .in("orders.status", ["paid", "shipped"])
      .not("product_id", "is", null),
    supabase.from("reviews").select("id", { count: "exact", head: true }),
    supabase.from("away_mode").select("return_date").eq("id", true).maybeSingle(),
  ]);

  // Top sellers by units sold across paid and shipped orders.
  const salesByProduct = new Map<
    string,
    { id: string; name: string; image_url: string | null; units: number; revenue_cents: number }
  >();
  for (const item of (soldItems as any[]) ?? []) {
    const entry = salesByProduct.get(item.product_id) ?? {
      id: item.product_id,
      name: item.product_name,
      image_url: item.image_url,
      units: 0,
      revenue_cents: 0,
    };
    entry.units += item.quantity;
    entry.revenue_cents += item.price_cents * item.quantity;
    salesByProduct.set(item.product_id, entry);
  }
  const topSellers = [...salesByProduct.values()]
    .sort((a, b) => b.units - a.units)
    .slice(0, 5);

  const lowStockAlerts = ((lowStockProducts as any[]) ?? []).filter(
    (p) =>
      !p.in_stock ||
      (p.low_stock_quantity != null && p.low_stock_quantity <= (p.low_stock_threshold ?? 3)),
  );

  return (
    <div className="space-y-6 md:space-y-8">

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">

        {/* Top Selling Products */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-brand-red" />
              Top Selling Products
            </h2>
            <span className="text-xs text-zinc-400">by units sold</span>
          </div>
          <Card>
            <CardContent className="p-0">
              {topSellers.length === 0 ? (
                <div className="p-8 text-center text-zinc-400 text-sm">No data yet.</div>
              ) : (
                <div className="divide-y">
                  {topSellers.map((p, i) => (
                    <div key={p.id} className="p-3 flex items-center gap-2 md:p-4 md:gap-3">
                      <span className="text-xs font-black text-zinc-300 w-4 shrink-0 md:w-5">
                        {i + 1}
                      </span>
                      {p.image_url ? (
                        <Image
                          src={p.image_url}
                          alt={p.name}
                          width={32}
                          height={32}
                          className="rounded object-contain bg-zinc-50 shrink-0 w-8 h-8 md:w-9 md:h-9"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded bg-zinc-100 shrink-0 flex items-center justify-center text-base md:w-9 md:h-9">
                          <Package size={16} className="text-zinc-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-xs text-zinc-900 truncate md:text-sm">
                          {p.name}
                        </p>
                        <p className="text-[10px] text-zinc-500 mt-0.5 md:text-xs">
                          {p.units} sold
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-bold text-zinc-900 md:text-sm">
                          {formatPrice(p.revenue_cents)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
            <div className="p-3 bg-zinc-50 border-t text-center">
              <Button variant="link" size="sm" asChild className="text-xs font-bold">
                <Link href={`/${locale}/admin/products`}>
                  View All Products <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </Card>
        </section>

        {/* Low Stock */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2 text-orange-700">
              <AlertTriangle className="h-5 w-5" />
              Low Stock Alerts
            </h2>
            {lowStockAlerts.length > 0 && (
              <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-1 rounded-full">
                {lowStockAlerts.length} Items
              </span>
            )}
          </div>
          <Card>
            <CardContent className="p-0">
              {lowStockAlerts.length === 0 ? (
                <div className="p-8 text-center text-zinc-400 text-sm">
                  All products are well stocked!
                </div>
              ) : (
                <div className="divide-y overflow-y-auto max-h-[320px] md:max-h-[512px]">
                  {lowStockAlerts.map((product, idx) => (
                    <div key={idx} className="p-3 flex items-center justify-between md:p-4">
                      <div className="min-w-0 pr-2">
                        <p className="font-bold text-xs text-zinc-900 truncate md:text-sm">{product.name}</p>
                        <p className="text-[10px] text-zinc-500 md:text-xs">
                          Threshold: {product.low_stock_threshold || 2}
                        </p>
                      </div>
                      <span className={`text-xs font-bold shrink-0 md:text-sm ${!product.in_stock ? "text-red-600" : "text-orange-600"}`}>
                        {!product.in_stock ? "Out of stock" : `${product.low_stock_quantity} left`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
            {lowStockAlerts.length > 0 && (
              <div className="p-3 bg-zinc-50 border-t text-center">
                <Button variant="link" size="sm" asChild className="text-xs font-bold">
                  <Link href={`/${locale}/admin/products?outOfStock=1&lowStock=1`}>
                    Manage Inventory <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            )}
          </Card>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">

        {/* Recent New Orders */}
        <section className="space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-600" />
            Recent Orders
          </h2>
          <Card>
            <CardContent className="p-0">
              {!recentOrders || recentOrders.length === 0 ? (
                <div className="p-8 text-center text-zinc-400 text-sm">No new orders yet.</div>
              ) : (
                <div className="divide-y">
                  {recentOrders.map((order) => (
                    <div key={order.id} className="p-3 flex items-center justify-between gap-2 hover:bg-zinc-50/50 transition-colors md:p-4">
                      <div className="flex items-center gap-2 min-w-0 md:gap-3">
                        <div className="bg-zinc-100 p-1.5 rounded text-zinc-500 shrink-0 md:p-2">
                          <ShoppingBag size={14} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-xs text-zinc-900 md:text-sm">
                            #{(order as any).order_number ?? order.id.slice(0, 8).toUpperCase()}
                          </p>
                          <p className="text-[10px] text-zinc-500 truncate max-w-[130px] md:text-xs md:max-w-none">{order.customer_email}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-xs md:text-sm">{formatPrice(order.total_cents)}</p>
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                          order.status === "paid"
                            ? "bg-green-50 text-green-700 border-green-100"
                            : "bg-zinc-50 text-zinc-500 border-zinc-200"
                        }`}>
                          {order.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Reviews */}
        <section className="space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Star className="h-5 w-5 text-orange-500" />
            Reviews
          </h2>
          <Card>
            <CardContent className="p-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-3xl font-bold">{reviewCount ?? 0}</p>
                <p className="text-xs text-zinc-500">total reviews</p>
              </div>
              <Button variant="link" size="sm" asChild className="text-xs font-bold">
                <Link href={`/${locale}/admin/reviews`}>
                  Manage Reviews <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>

      {/* Bottom cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <AwayModeCard locale={locale} returnDate={awayModeRow?.return_date ?? null} />

        <Card className="bg-black text-white border-none">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="h-5 w-5" />
              Catalogue Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6 md:gap-8">
            <div>
              <p className="text-zinc-400 text-xs uppercase font-bold mb-1">{t("stats.brands")}</p>
              <p className="text-2xl font-bold">{brandCount}</p>
            </div>
            <div>
              <p className="text-zinc-400 text-xs uppercase font-bold mb-1">{t("stats.categories")}</p>
              <p className="text-2xl font-bold">{categoryCount}</p>
            </div>
            <div>
              <p className="text-zinc-400 text-xs uppercase font-bold mb-1">Products</p>
              <p className="text-2xl font-bold">{productCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-brand-red text-white border-none">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail size={20} />
              Marketing Stats
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-100 text-sm">
              Create and manage your newsletters in the Marketing Hub.
            </p>
            <Button
              asChild
              variant="secondary"
              size="sm"
              className="mt-4 bg-white text-brand-red hover:bg-red-50 border-none font-bold"
            >
              <Link href={`/${locale}/admin/marketing`}>Go to Marketing Hub</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
