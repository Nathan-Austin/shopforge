"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, ShoppingBag, ChevronRight, CalendarRange, X } from "lucide-react";
import { formatPrice } from "@/lib/format";

type Order = {
  id: string;
  order_number: number | null;
  customer_email: string;
  shipping_name: string | null;
  shipping_country: string | null;
  total_cents: number;
  currency: string;
  status: string;
  created_at: string;
};

const STATUS_STYLES: Record<string, string> = {
  paid:               "bg-green-50 text-green-700 border-green-200",
  shipped:            "bg-blue-50 text-blue-700 border-blue-200",
  cancelled:          "bg-red-50 text-red-600 border-red-200",
  refunded:           "bg-orange-50 text-orange-700 border-orange-200",
  partially_refunded: "bg-orange-50 text-orange-700 border-orange-200",
  pending:            "bg-zinc-50 text-zinc-500 border-zinc-200",
};

const ALL_STATUSES = ["all", "paid", "shipped", "pending", "cancelled", "refunded", "partially_refunded"];
const STATUS_LABELS: Record<string, string> = { paid: "Processing", shipped: "Completed", partially_refunded: "Partially Refunded" };
const DEFAULT_VISIBLE = 20;

export default function OrdersClient({ orders, locale }: { orders: Order[]; locale: string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showAll, setShowAll] = useState(false);

  const isFiltered = search.trim() !== "" || statusFilter !== "all" || dateFrom !== "" || dateTo !== "";

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;

      if (dateFrom) {
        const orderDate = o.created_at.slice(0, 10);
        if (orderDate < dateFrom) return false;
      }
      if (dateTo) {
        const orderDate = o.created_at.slice(0, 10);
        if (orderDate > dateTo) return false;
      }

      if (!q) return true;
      return (
        String(o.order_number ?? "").includes(q) ||
        o.customer_email.toLowerCase().includes(q) ||
        (o.shipping_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [orders, search, statusFilter, dateFrom, dateTo]);

  const visible = isFiltered || showAll ? filtered : filtered.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = filtered.length - DEFAULT_VISIBLE;

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length };
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

  function clearDates() {
    setDateFrom("");
    setDateTo("");
  }

  return (
    <div className="space-y-5">
      {/* Row 1: Search + status filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            placeholder="Search by order #, name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap capitalize ${
                statusFilter === s
                  ? "bg-brand-red text-white border-brand-red"
                  : "bg-white text-zinc-600 border-zinc-200 hover:border-brand-red hover:text-brand-red"
              }`}
            >
              {s === "all" ? "All" : (STATUS_LABELS[s] ?? s)} {counts[s] ? `(${counts[s]})` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: Date range */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-zinc-500 font-medium">
          <CalendarRange size={14} className="text-zinc-400" />
          <span>Date range</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setShowAll(false); }}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-brand-red"
          />
          <span className="text-zinc-400 text-xs">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setShowAll(false); }}
            min={dateFrom || undefined}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-brand-red"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={clearDates}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-brand-red transition-colors"
            >
              <X size={13} />
              Clear
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-zinc-400">
        {isFiltered || showAll
          ? `${filtered.length} order${filtered.length !== 1 ? "s" : ""} found`
          : `Showing ${Math.min(DEFAULT_VISIBLE, filtered.length)} of ${filtered.length} orders`}
      </p>

      {/* Orders table */}
      {visible.length === 0 ? (
        <div className="py-16 text-center text-zinc-400 text-sm border border-dashed border-zinc-200 rounded-xl">
          No orders match your search.
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border overflow-hidden bg-white">
            {/* Desktop header */}
            <div className="hidden sm:grid sm:grid-cols-[1fr_2fr_1.5fr_1fr_1fr_auto] gap-4 px-5 py-3 bg-zinc-50 border-b border-border text-xs font-bold uppercase tracking-widest text-zinc-400">
              <span>Order</span>
              <span>Customer</span>
              <span>Date</span>
              <span>Total</span>
              <span>Status</span>
              <span />
            </div>

            <div className="divide-y divide-zinc-100">
              {visible.map((order) => {
                const orderRef = order.order_number
                  ? String(order.order_number).padStart(4, "0")
                  : order.id.slice(0, 8).toUpperCase();

                const rowContent = (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="hidden sm:flex bg-zinc-100 p-1.5 rounded text-zinc-500 shrink-0">
                        <ShoppingBag size={13} />
                      </div>
                      <span className="font-mono font-bold text-sm text-zinc-900">#{orderRef}</span>
                    </div>

                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-zinc-900 truncate">
                        {order.shipping_name || "—"}
                      </p>
                      <p className="text-xs text-zinc-400 truncate">{order.customer_email}</p>
                    </div>

                    <p className="text-xs text-zinc-500">
                      {new Date(order.created_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      <span className="text-zinc-400 ml-1">
                        {new Date(order.created_at).toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </p>

                    <p className="font-bold text-sm text-zinc-900">
                      {formatPrice(order.total_cents, order.currency)}
                    </p>

                    <span className={`inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded border w-fit ${STATUS_STYLES[order.status] ?? STATUS_STYLES.pending}`}>
                      {STATUS_LABELS[order.status] ?? order.status}
                    </span>

                    <ChevronRight size={16} className="hidden sm:block text-zinc-300 group-hover:text-brand-red transition-colors justify-self-end" />
                  </>
                );

                const href = `/${locale}/admin/orders/${order.id}`;

                return (
                  <Link
                    key={order.id}
                    href={href}
                    className="group flex flex-col gap-1 px-4 py-3 hover:bg-zinc-50 transition-colors sm:grid sm:grid-cols-[1fr_2fr_1.5fr_1fr_1fr_auto] sm:items-center sm:gap-4 sm:px-5 sm:py-4"
                  >
                    {rowContent}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Show all button — only when not filtered and there are hidden rows */}
          {!isFiltered && !showAll && hiddenCount > 0 && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full py-2.5 rounded-xl border border-dashed border-zinc-200 text-sm text-zinc-500 hover:border-brand-red hover:text-brand-red transition-colors"
            >
              Show all {filtered.length} orders
            </button>
          )}
        </>
      )}
    </div>
  );
}
