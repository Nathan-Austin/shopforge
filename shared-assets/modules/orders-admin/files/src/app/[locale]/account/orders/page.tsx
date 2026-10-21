import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/format";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";

export default async function OrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const t = await getTranslations("Account");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${locale}/auth/sign-in`);
  }

  // Fetch all orders with items
  const { data: orders } = await supabase
    .from("orders")
    .select("*, order_items(*, product:products(slug))")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8">
        <Link
          href={`/${locale}/account`}
          className="inline-flex items-center text-sm font-bold text-zinc-500 hover:text-brand-red transition-colors mb-4"
        >
          <ArrowLeft size={16} className="mr-2" />
          Back to Account
        </Link>
        <h1 className="text-3xl font-bold text-zinc-900">
          {t("orders.title")}
        </h1>
      </div>

      <div className="space-y-6">
        {!orders || orders.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-zinc-500">{t("orders.empty")}</p>
              <Link
                href={`/${locale}/shop`}
                className="mt-4 inline-block font-bold text-brand-red hover:underline"
              >
                Go to shop
              </Link>
            </CardContent>
          </Card>
        ) : (
          orders.map((order) => (
            <Card key={order.id} className="overflow-hidden">
              <CardHeader className="bg-zinc-50 border-b border-zinc-100 flex flex-row items-center justify-between py-4">
                <div className="flex flex-wrap gap-x-8 gap-y-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      {t("orders.orderNumber")}
                    </p>
                    <p className="text-sm font-mono font-bold text-zinc-900 uppercase">
                      #{(order as any).order_number ?? order.id.split("-")[0]}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      {t("orders.date")}
                    </p>
                    <p className="text-sm font-medium text-zinc-900">
                      {new Date(order.created_at).toLocaleDateString(locale, {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      {t("orders.total")}
                    </p>
                    <p className="text-sm font-bold text-zinc-900">
                      {formatPrice(order.total_cents, order.currency, locale)}
                    </p>
                  </div>
                </div>
                <Badge
                  className={
                    order.status === "paid"
                      ? "bg-green-100 text-green-700 border-green-200"
                      : order.status === "shipped"
                        ? "bg-blue-100 text-blue-700 border-blue-200"
                        : "bg-zinc-100 text-zinc-700 border-zinc-200"
                  }
                >
                  {order.status}
                </Badge>
              </CardHeader>
              <CardContent className="py-6">
                <div className="space-y-4">
                  {(order.order_items || []).map((item: any) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-zinc-50 rounded-lg flex items-center justify-center text-xl border border-zinc-100">
                          🌶️
                        </div>
                        <div>
                          <p className="font-bold text-zinc-900">
                            {item.product_name}
                          </p>
                          <p className="text-zinc-500">Qty: {item.quantity}</p>
                          {item.product?.slug && (
                            <Link
                              href={`/${locale}/shop/${item.product.slug}#reviews`}
                              className="text-xs font-bold text-brand-red hover:underline"
                            >
                              Leave a Review
                            </Link>
                          )}
                        </div>
                      </div>
                      <p className="font-medium text-zinc-900">
                        {formatPrice(item.price_cents * item.quantity, order.currency, locale)}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 pt-6 border-t border-zinc-100 flex flex-col sm:flex-row justify-between gap-4">
                  <div className="text-xs text-zinc-500">
                    <p className="font-bold uppercase tracking-widest mb-1">
                      Shipping Address
                    </p>
                    <p>{order.shipping_name}</p>
                    <p>{order.shipping_street}</p>
                    <p>
                      {order.shipping_postal_code} {order.shipping_city}
                    </p>
                    <p>{order.shipping_country}</p>
                  </div>
                  {order.status === "shipped" && (
                    <div className="flex items-end">
                      <Badge
                        variant="outline"
                        className="text-blue-600 border-blue-200"
                      >
                        In Transit
                      </Badge>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
