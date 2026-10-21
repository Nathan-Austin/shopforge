import { requireShopOwner } from "../lib/auth";
import { Suspense } from "react";
import AnalyticsClient from "./AnalyticsClient";
import { REVENUE_STATUSES } from "./revenue";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);

  const [
    { data: allProducts },
    { data: salesData },
    { count: reviewCount },
    { count: productCount },
  ] = await Promise.all([
    supabase.from("products").select("id, name").eq("is_active", true).order("name"),
    supabase.from("orders").select("total_cents, customer_email, created_at").in("status", REVENUE_STATUSES),
    supabase.from("reviews").select("id", { count: "exact", head: true }),
    supabase.from("products").select("id", { count: "exact", head: true }),
  ]);

  const sales = (salesData ?? []) as { total_cents: number; customer_email: string; created_at: string }[];
  const totalRevenue = sales.reduce((acc, o) => acc + o.total_cents, 0);
  const customerCount = new Set(sales.map((o) => o.customer_email.toLowerCase())).size;
  const years = [...new Set(sales.map((o) => new Date(o.created_at).getFullYear()))].sort((a, b) => b - a);

  return (
    <Suspense>
      <AnalyticsClient
        years={years}
        allProducts={(allProducts ?? []) as { id: string; name: string }[]}
        totalRevenue={totalRevenue}
        totalOrders={sales.length}
        reviewCount={reviewCount ?? 0}
        customerCount={customerCount}
        productCount={productCount ?? 0}
      />
    </Suspense>
  );
}
