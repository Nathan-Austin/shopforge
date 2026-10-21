"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/format";
import { format, startOfYear, endOfYear, subYears, startOfMonth, endOfMonth, subMonths, eachMonthOfInterval } from "date-fns";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, ShoppingBag, Users, Star, ArrowUpDown, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { REVENUE_STATUSES } from "./revenue";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthRow { month: string; revenue: number; orders: number }
interface ProductRow { product_id: string | null; product_name: string; units: number; revenue: number }

interface PeriodData {
  monthly: MonthRow[];
  products: ProductRow[];
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
}

interface Props {
  years: number[];
  allProducts: { id: string; name: string }[];
  totalRevenue: number;
  totalOrders: number;
  reviewCount: number;
  customerCount: number;
  productCount: number;
}

// ─── Preset helpers ────────────────────────────────────────────────────────────

type Preset = { label: string; start: string; end: string };

function toISO(d: Date) { return format(d, "yyyy-MM-dd"); }

function buildPresets(years: number[]): Preset[] {
  const today = new Date();
  const presets: Preset[] = [
    { label: "Last 30 days", start: toISO(subMonths(today, 1)), end: toISO(today) },
    { label: "Last 90 days", start: toISO(subMonths(today, 3)), end: toISO(today) },
    { label: "This year",    start: toISO(startOfYear(today)),  end: toISO(today) },
    { label: "Last year",    start: toISO(startOfYear(subYears(today, 1))), end: toISO(endOfYear(subYears(today, 1))) },
  ];
  years.forEach((y) => {
    if (y < today.getFullYear() - 1) {
      presets.push({ label: String(y), start: `${y}-01-01`, end: `${y}-12-31` });
    }
  });
  return presets;
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────

function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-lg text-xs space-y-1">
      <p className="font-bold text-zinc-700 mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-zinc-500">{p.name}:</span>
          <span className="font-bold text-zinc-900">{formatPrice(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, valueA, valueB, format: fmt, icon: Icon, colorA, colorB,
}: {
  label: string;
  valueA: number;
  valueB: number | null;
  format: (v: number) => string;
  icon: React.ElementType;
  colorA: string;
  colorB: string;
}) {
  const diff = valueB !== null && valueB !== 0 ? ((valueA - valueB) / valueB) * 100 : null;
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">{label}</span>
          <div className="bg-zinc-100 p-2 rounded-lg">
            <Icon className="h-4 w-4 text-zinc-500" />
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorA }} />
            <span className="text-xl font-bold text-zinc-900">{fmt(valueA)}</span>
            {diff !== null && (
              <span className={`text-xs font-bold ${diff >= 0 ? "text-green-600" : "text-red-500"}`}>
                {diff >= 0 ? "+" : ""}{diff.toFixed(1)}%
              </span>
            )}
          </div>
          {valueB !== null && (
            <div className="flex items-baseline gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorB }} />
              <span className="text-base font-semibold text-zinc-400">{fmt(valueB)}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

const COLOR_A = "#dc2626"; // brand red
const COLOR_B = "#94a3b8"; // slate

export default function AnalyticsClient({
  years,
  allProducts,
  totalRevenue,
  totalOrders,
  reviewCount,
  customerCount,
  productCount,
}: Props) {
  const presets = buildPresets(years);

  const [presetA, setPresetA] = useState<string>(presets[2]?.label ?? "This year");
  const [presetB, setPresetB] = useState<string>("none");
  const [customA, setCustomA] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [customB, setCustomB] = useState<{ start: string; end: string }>({ start: "", end: "" });

  const [dataA, setDataA] = useState<PeriodData | null>(null);
  const [dataB, setDataB] = useState<PeriodData | null>(null);
  const [loading, setLoading] = useState(false);

  const [sortBy, setSortBy] = useState<"revenue" | "units">("revenue");
  const [productFilter, setProductFilter] = useState<string>("");

  function getRange(preset: string, custom: { start: string; end: string }): { start: string; end: string } | null {
    if (preset === "none") return null;
    if (preset === "custom") return custom.start && custom.end ? custom : null;
    return presets.find((p) => p.label === preset) ?? null;
  }

  const fetchPeriod = useCallback(async (start: string, end: string): Promise<PeriodData> => {
    const { data } = await supabase
      .from("orders")
      .select("total_cents, created_at, order_items(product_id, product_name, quantity, price_cents)")
      .in("status", REVENUE_STATUSES)
      .gte("created_at", `${start}T00:00:00Z`)
      .lte("created_at", `${end}T23:59:59Z`);
    const orders = (data ?? []) as {
      total_cents: number;
      created_at: string;
      order_items: { product_id: string | null; product_name: string; quantity: number; price_cents: number }[];
    }[];

    // One row per month in the range, including months with no sales.
    const byMonth = new Map<string, MonthRow>();
    for (const m of eachMonthOfInterval({ start: new Date(start), end: new Date(end) })) {
      byMonth.set(format(m, "yyyy-MM"), { month: format(m, "MMM yy"), revenue: 0, orders: 0 });
    }
    const byProduct = new Map<string, ProductRow>();
    for (const order of orders) {
      const row = byMonth.get(format(new Date(order.created_at), "yyyy-MM"));
      if (row) {
        row.revenue += order.total_cents;
        row.orders += 1;
      }
      for (const item of order.order_items ?? []) {
        const key = item.product_id ?? item.product_name;
        const p = byProduct.get(key) ?? { product_id: item.product_id, product_name: item.product_name, units: 0, revenue: 0 };
        p.units += item.quantity;
        p.revenue += item.price_cents * item.quantity;
        byProduct.set(key, p);
      }
    }

    const monthly = [...byMonth.values()];
    const products = [...byProduct.values()];
    const totalRevenue  = monthly.reduce((s, r) => s + r.revenue, 0);
    const totalOrders   = monthly.reduce((s, r) => s + r.orders,  0);
    const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

    return { monthly, products, totalRevenue, totalOrders, avgOrderValue };
  }, []);

  useEffect(() => {
    async function load() {
      const rangeA = getRange(presetA, customA);
      if (!rangeA) { setDataA(null); setDataB(null); return; }

      setLoading(true);
      const rangeB = getRange(presetB, customB);

      const [pA, pB] = await Promise.all([
        fetchPeriod(rangeA.start, rangeA.end),
        rangeB ? fetchPeriod(rangeB.start, rangeB.end) : Promise.resolve(null),
      ]);

      setDataA(pA);
      setDataB(pB);
      setLoading(false);
    }

    load();
  }, [presetA, presetB, customA, customB, fetchPeriod]);

  // Build chart data — merge period A and B by month-index so lines overlay cleanly
  const chartData = (() => {
    if (!dataA) return [];
    const rows = dataA.monthly.map((m, i) => ({
      label: m.month,
      "Period A": m.revenue,
      "Period A orders": m.orders,
      ...(dataB?.monthly[i] ? {
        "Period B": dataB.monthly[i].revenue,
        "Period B orders": dataB.monthly[i].orders,
      } : {}),
    }));
    return rows;
  })();

  // Filtered products
  const products = (dataA?.products ?? [])
    .filter((p) => !productFilter || p.product_name.toLowerCase().includes(productFilter.toLowerCase()))
    .sort((a, b) => (sortBy === "revenue" ? b.revenue - a.revenue : b.units - a.units))
    .slice(0, 20);

  const rangeALabel = getRange(presetA, customA);
  const rangeBLabel = getRange(presetB, customB);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-foreground">Sales Analytics</h2>
        <p className="text-sm text-zinc-500 mt-1">
          Paid, shipped and partially refunded orders. Compare periods side by side.
        </p>
      </div>

      {/* Financial overview */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Total Revenue",
            value: formatPrice(totalRevenue),
            sub: "all time",
            icon: TrendingUp,
            color: "text-green-600",
            bg: "bg-green-50",
          },
          {
            label: "Total Orders",
            value: totalOrders.toLocaleString(),
            sub: totalOrders > 0 ? `${formatPrice(Math.round(totalRevenue / totalOrders))} average` : "no orders yet",
            icon: ShoppingBag,
            color: "text-red-600",
            bg: "bg-red-50",
          },
          {
            label: "Customers",
            value: customerCount.toLocaleString(),
            sub: "unique buyers",
            icon: Users,
            color: "text-blue-600",
            bg: "bg-blue-50",
          },
          {
            label: "Reviews",
            value: reviewCount.toLocaleString(),
            sub: `${productCount} products catalogued`,
            icon: Star,
            color: "text-orange-500",
            bg: "bg-orange-50",
          },
        ].map((card) => (
          <Card key={card.label} className="border-none shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-4 sm:hidden">
                <div className={`${card.bg} p-3 rounded-xl shrink-0`}>
                  <card.icon className={`h-6 w-6 ${card.color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground leading-tight">{card.label}</p>
                  <div className="text-2xl font-bold mt-0.5">{card.value}</div>
                  <p className="text-xs text-zinc-400 mt-0.5 leading-tight truncate">{card.sub}</p>
                </div>
              </div>
              <div className="hidden sm:block">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{card.label}</p>
                  <div className={`${card.bg} p-2 rounded-lg`}>
                    <card.icon className={`h-4 w-4 ${card.color}`} />
                  </div>
                </div>
                <div className="text-2xl font-bold">{card.value}</div>
                <p className="text-xs text-zinc-400 mt-1">{card.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Period selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Period A */}
        <Card className="border-2 shadow-sm" style={{ borderColor: COLOR_A + "40" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ background: COLOR_A }} />
              Period A
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setPresetA(p.label)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                    presetA === p.label ? "text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                  style={presetA === p.label ? { background: COLOR_A } : {}}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => setPresetA("custom")}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                  presetA === "custom" ? "text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
                style={presetA === "custom" ? { background: COLOR_A } : {}}
              >
                Custom
              </button>
            </div>
            {presetA === "custom" && (
              <div className="flex gap-2">
                <input type="date" value={customA.start} onChange={(e) => setCustomA((p) => ({ ...p, start: e.target.value }))}
                  className="flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-red" />
                <input type="date" value={customA.end}   onChange={(e) => setCustomA((p) => ({ ...p, end:   e.target.value }))}
                  className="flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
            )}
            {rangeALabel && (
              <p className="text-[10px] text-zinc-400">{rangeALabel.start} → {rangeALabel.end}</p>
            )}
          </CardContent>
        </Card>

        {/* Period B */}
        <Card className="border-2 shadow-sm" style={{ borderColor: COLOR_B + "80" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ background: COLOR_B }} />
              Period B <span className="font-normal text-zinc-400">(comparison – optional)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setPresetB("none")}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                  presetB === "none" ? "bg-zinc-700 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                None
              </button>
              {presets.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setPresetB(p.label)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                    presetB === p.label ? "text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                  style={presetB === p.label ? { background: COLOR_B } : {}}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => setPresetB("custom")}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                  presetB === "custom" ? "text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
                style={presetB === "custom" ? { background: COLOR_B } : {}}
              >
                Custom
              </button>
            </div>
            {presetB === "custom" && (
              <div className="flex gap-2">
                <input type="date" value={customB.start} onChange={(e) => setCustomB((p) => ({ ...p, start: e.target.value }))}
                  className="flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-red" />
                <input type="date" value={customB.end}   onChange={(e) => setCustomB((p) => ({ ...p, end:   e.target.value }))}
                  className="flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-red" />
              </div>
            )}
            {rangeBLabel && (
              <p className="text-[10px] text-zinc-400">{rangeBLabel.start} → {rangeBLabel.end}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
        </div>
      )}

      {!loading && dataA && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiCard
              label="Revenue"
              valueA={dataA.totalRevenue}
              valueB={dataB?.totalRevenue ?? null}
              format={formatPrice}
              icon={TrendingUp}
              colorA={COLOR_A}
              colorB={COLOR_B}
            />
            <KpiCard
              label="Orders"
              valueA={dataA.totalOrders}
              valueB={dataB?.totalOrders ?? null}
              format={(v) => v.toLocaleString()}
              icon={ShoppingBag}
              colorA={COLOR_A}
              colorB={COLOR_B}
            />
            <KpiCard
              label="Avg Order Value"
              valueA={dataA.avgOrderValue}
              valueB={dataB?.avgOrderValue ?? null}
              format={formatPrice}
              icon={Users}
              colorA={COLOR_A}
              colorB={COLOR_B}
            />
          </div>

          {/* Revenue over time */}
          <Card className="border-none shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold">Revenue by Month</CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <p className="text-center text-zinc-400 text-sm py-12">No data for this period.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} />
                    <YAxis
                      tickFormatter={(v) => `€${(v / 100).toFixed(0)}`}
                      tick={{ fontSize: 11, fill: "#71717a" }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip content={<RevenueTooltip />} />
                    <Legend
                      formatter={(value) => <span className="text-xs font-semibold text-zinc-600">{value}</span>}
                    />
                    <Line
                      type="monotone"
                      dataKey="Period A"
                      stroke={COLOR_A}
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                    {dataB && (
                      <Line
                        type="monotone"
                        dataKey="Period B"
                        stroke={COLOR_B}
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Orders by Month bar chart */}
          <Card className="border-none shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold">Orders by Month</CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <p className="text-center text-zinc-400 text-sm py-12">No data for this period.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} width={36} />
                    <Tooltip
                      formatter={(value: any, name: any) => [Number(value).toLocaleString(), String(name)]}
                      contentStyle={{ borderRadius: 12, border: "1px solid #e4e4e7", fontSize: 12 }}
                    />
                    <Legend formatter={(value) => <span className="text-xs font-semibold text-zinc-600">{value}</span>} />
                    <Bar dataKey="Period A orders" name="Period A" fill={COLOR_A} radius={[4, 4, 0, 0]} />
                    {dataB && (
                      <Bar dataKey="Period B orders" name="Period B" fill={COLOR_B} radius={[4, 4, 0, 0]} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Product breakdown */}
          <Card className="border-none shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <CardTitle className="text-base font-bold">Product Sales Breakdown</CardTitle>
                <div className="flex items-center gap-2">
                  <input
                    type="search"
                    placeholder="Filter products…"
                    value={productFilter}
                    onChange={(e) => setProductFilter(e.target.value)}
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-red w-44"
                  />
                  <button
                    onClick={() => setSortBy(sortBy === "revenue" ? "units" : "revenue")}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold hover:bg-zinc-50 transition-colors"
                  >
                    <ArrowUpDown size={12} />
                    {sortBy === "revenue" ? "By Revenue" : "By Units"}
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {products.length === 0 ? (
                <p className="text-center text-zinc-400 text-sm py-12 px-4">No product sales data for this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100 bg-zinc-50">
                        <th className="px-4 py-2.5 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider">#</th>
                        <th className="px-4 py-2.5 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider">Product</th>
                        <th className="px-4 py-2.5 text-right text-xs font-bold text-zinc-500 uppercase tracking-wider">Units (A)</th>
                        {dataB && <th className="px-4 py-2.5 text-right text-xs font-bold text-zinc-500 uppercase tracking-wider">Units (B)</th>}
                        <th className="px-4 py-2.5 text-right text-xs font-bold text-zinc-500 uppercase tracking-wider">Revenue (A)</th>
                        {dataB && <th className="px-4 py-2.5 text-right text-xs font-bold text-zinc-500 uppercase tracking-wider">Revenue (B)</th>}
                        {dataB && <th className="px-4 py-2.5 text-right text-xs font-bold text-zinc-500 uppercase tracking-wider">Δ Revenue</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {products.map((p, i) => {
                        const periodBProduct = dataB?.products.find(
                          (bp) => bp.product_id === p.product_id || bp.product_name === p.product_name
                        );
                        const diff = periodBProduct && periodBProduct.revenue > 0
                          ? ((p.revenue - periodBProduct.revenue) / periodBProduct.revenue) * 100
                          : null;
                        return (
                          <tr key={p.product_id ?? p.product_name} className="hover:bg-zinc-50/50 transition-colors">
                            <td className="px-4 py-3 text-xs font-black text-zinc-300 w-8">{i + 1}</td>
                            <td className="px-4 py-3 font-medium text-zinc-900 max-w-xs truncate">{p.product_name}</td>
                            <td className="px-4 py-3 text-right text-zinc-600">{p.units.toLocaleString()}</td>
                            {dataB && (
                              <td className="px-4 py-3 text-right text-zinc-400">
                                {periodBProduct ? periodBProduct.units.toLocaleString() : "—"}
                              </td>
                            )}
                            <td className="px-4 py-3 text-right font-bold text-zinc-900">{formatPrice(p.revenue)}</td>
                            {dataB && (
                              <td className="px-4 py-3 text-right text-zinc-400">
                                {periodBProduct ? formatPrice(periodBProduct.revenue) : "—"}
                              </td>
                            )}
                            {dataB && (
                              <td className="px-4 py-3 text-right">
                                {diff !== null ? (
                                  <span className={`text-xs font-bold ${diff >= 0 ? "text-green-600" : "text-red-500"}`}>
                                    {diff >= 0 ? "+" : ""}{diff.toFixed(1)}%
                                  </span>
                                ) : (
                                  <span className="text-zinc-300">—</span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
