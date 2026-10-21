import { requireShopOwner } from "../lib/auth";
import OrdersClient from "./OrdersClient";
import { ShoppingBag } from "lucide-react";

export default async function AdminOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params as { locale: string };
  const { supabase } = await requireShopOwner(locale);

  // PostgREST caps each response at 1000 rows, so page through until a short
  // page comes back -- otherwise the list (and its count) silently truncates.
  async function fetchAll<T>(
    query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
  ): Promise<T[]> {
    const PAGE = 1000;
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await query(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) return rows;
    }
  }

  const orders = await fetchAll((from, to) =>
    supabase
      .from("orders")
      .select("id, order_number, customer_email, shipping_name, shipping_country, total_cents, currency, status, created_at")
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="bg-zinc-100 p-2 rounded-lg">
          <ShoppingBag size={20} className="text-zinc-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Orders</h1>
          <p className="text-sm text-zinc-400">{orders.length} total orders</p>
        </div>
      </div>

      <OrdersClient orders={orders} locale={locale} />
    </div>
  );
}
