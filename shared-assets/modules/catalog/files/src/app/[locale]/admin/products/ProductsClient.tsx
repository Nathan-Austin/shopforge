"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive } from "lucide-react";
import type { StoreProduct } from "@/components/store/types";
import { archiveProduct } from "../actions/archiveProduct";

interface Category {
  id: number;
  name: string;
  slug: string;
}

interface ProductsClientProps {
  products: StoreProduct[];
  categories: Category[];
  locale: string;
  labels: {
    name: string;
    category: string;
    brand: string;
    heat: string;
    price: string;
    actions: string;
    edit: string;
    notSet: string;
    empty: string;
    newProduct: string;
    heading: string;
    subheading: string;
  };
}

export default function ProductsClient({
  products,
  categories,
  locale,
  labels,
}: ProductsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [showOutOfStock, setShowOutOfStock] = useState(searchParams.get("outOfStock") === "1");
  const [showLowStock, setShowLowStock] = useState(searchParams.get("lowStock") === "1");
  const [localProducts, setLocalProducts] = useState(products);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function isLowStock(p: StoreProduct) {
    return (
      p.in_stock !== false &&
      p.low_stock_quantity != null &&
      p.low_stock_quantity <= (p.low_stock_threshold ?? 3)
    );
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return localProducts.filter((p) => {
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.brand?.name?.toLowerCase().includes(q);
      const matchesCategory =
        !selectedCategory ||
        p.category?.id?.toString() === selectedCategory ||
        p.category?.slug === selectedCategory;
      const matchesStock =
        (!showOutOfStock && !showLowStock) ||
        (showOutOfStock && p.in_stock === false) ||
        (showLowStock && isLowStock(p));
      return matchesSearch && matchesCategory && matchesStock;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localProducts, search, selectedCategory, showOutOfStock, showLowStock]);

  function handleArchive(product: StoreProduct) {
    if (!confirm(`Archive "${product.name}"? It will be hidden from this list and the dashboard. You can reinstate it at any time.`)) return;

    setLocalProducts((prev) => prev.filter((p) => p.id !== product.id));
    setArchivingId(product.id as string);

    startTransition(async () => {
      const result = await archiveProduct(product.id as string, locale);
      setArchivingId(null);
      if (result.error) {
        setLocalProducts(products);
        alert(`Failed to archive: ${result.error}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            {labels.heading}
          </h2>
          <p className="text-sm text-text-muted">{labels.subheading}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/${locale}/admin/products/archived`}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            <Archive className="h-4 w-4" />
            Archived
          </Link>
          <Link
            href={`/${locale}/admin/products/new`}
            className="inline-flex items-center rounded-full bg-brand-red px-4 py-2 text-sm font-semibold text-white"
          >
            {labels.newProduct}
          </Link>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          placeholder="Search by name or brand…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red"
        />
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red sm:w-56"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id.toString()}>
              {cat.name}
            </option>
          ))}
        </select>
        {(search || selectedCategory || showOutOfStock || showLowStock) && (
          <button
            onClick={() => {
              setSearch("");
              setSelectedCategory("");
              setShowOutOfStock(false);
              setShowLowStock(false);
            }}
            className="text-xs font-semibold text-brand-red hover:underline whitespace-nowrap"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-sm text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showOutOfStock}
            onChange={(e) => setShowOutOfStock(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Show out of stock
        </label>
        <label className="flex items-center gap-1.5 text-sm text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showLowStock}
            onChange={(e) => setShowLowStock(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Show low stock
        </label>
      </div>

      <p className="text-xs text-text-muted">
        Showing {filtered.length} of {localProducts.length} products
      </p>

      <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-stone-50 text-left text-sm font-semibold text-text-secondary">
            <tr>
              <th className="px-4 py-3">{labels.name}</th>
              <th className="px-4 py-3">{labels.category}</th>
              <th className="px-4 py-3">{labels.brand}</th>
              <th className="px-4 py-3">{labels.heat}</th>
              <th className="px-4 py-3">{labels.price}</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3 text-right">{labels.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-sm">
            {filtered.map((product) => (
              <tr key={product.id} className={archivingId === product.id ? "opacity-40" : ""}>
                <td className="px-4 py-3 font-medium text-foreground">
                  {product.name}
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {product.category?.name || labels.notSet}
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {product.brand?.name || "—"}
                </td>
                <td className="px-4 py-3">{product.heatLevel || "—"}</td>
                <td className="px-4 py-3 font-semibold">
                  <div className="flex items-center gap-2">
                    {product.on_sale && product.sale_price_cents != null ? (
                      <>
                        <span className="text-xs text-zinc-400 line-through">
                          {(product.price_cents / 100).toLocaleString(locale, {
                            style: "currency",
                            currency: product.currency,
                          })}
                        </span>
                        <span className="text-orange-600">
                          {(product.sale_price_cents / 100).toLocaleString(locale, {
                            style: "currency",
                            currency: product.currency,
                          })}
                        </span>
                        <span className="rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                          Sale
                        </span>
                      </>
                    ) : (
                      (product.price_cents / 100).toLocaleString(locale, {
                        style: "currency",
                        currency: product.currency,
                      })
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {product.in_stock === false ? (
                    <span className="text-xs font-bold text-red-600">Out of stock</span>
                  ) : isLowStock(product) ? (
                    <span className="text-xs font-bold text-orange-600">
                      {product.low_stock_quantity} left
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400">In stock</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      href={`/${locale}/admin/products/${product.id}`}
                      className="text-sm font-semibold text-brand-red hover:underline"
                    >
                      {labels.edit}
                    </Link>
                    <button
                      onClick={() => handleArchive(product)}
                      className="text-sm font-semibold text-zinc-400 hover:text-zinc-700 transition-colors"
                      title="Archive product"
                    >
                      Archive
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-text-muted">
                  {localProducts.length === 0 ? labels.empty : "No products match your search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
