"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { reinstateProduct } from "../../actions/reinstateProduct";

interface Product {
  id: string;
  name: string;
  slug: string;
  price_cents: number;
  currency: string;
  heatLevel: any;
  image_url: string | null;
  brand: { id: any; name: string; slug: string } | null;
  category: { id: any; name: string; slug: string } | null;
}

interface Props {
  products: Product[];
  locale: string;
}

export default function ArchivedProductsClient({ products, locale }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [localProducts, setLocalProducts] = useState(products);
  const [reinstatingId, setReinstatingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return localProducts;
    return localProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.brand?.name?.toLowerCase().includes(q),
    );
  }, [localProducts, search]);

  function handleReinstate(product: Product) {
    if (!confirm(`Reinstate "${product.name}"? It will reappear in the main products list.`)) return;

    setLocalProducts((prev) => prev.filter((p) => p.id !== product.id));
    setReinstatingId(product.id);

    startTransition(async () => {
      const result = await reinstateProduct(product.id, locale);
      setReinstatingId(null);
      if (result.error) {
        setLocalProducts(products);
        alert(`Failed to reinstate: ${result.error}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href={`/${locale}/admin/products`}
            className="flex items-center gap-1.5 text-sm font-semibold text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Products
          </Link>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-foreground">Archived Products</h2>
        <p className="text-sm text-text-muted">
          {localProducts.length} archived {localProducts.length === 1 ? "product" : "products"} — hidden from the dashboard and low stock alerts.
        </p>
      </div>

      <input
        type="search"
        placeholder="Search by name or brand…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red"
      />

      <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-sm">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-stone-50 text-left text-sm font-semibold text-text-secondary">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Brand</th>
              <th className="px-4 py-3">Heat</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-sm">
            {filtered.map((product) => (
              <tr
                key={product.id}
                className={`${reinstatingId === product.id ? "opacity-40" : ""} bg-zinc-50/50`}
              >
                <td className="px-4 py-3 font-medium text-zinc-500">{product.name}</td>
                <td className="px-4 py-3 text-text-muted">
                  {product.category?.name || "—"}
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {product.brand?.name || "—"}
                </td>
                <td className="px-4 py-3 text-text-muted">{product.heatLevel || "—"}</td>
                <td className="px-4 py-3 font-semibold text-zinc-500">
                  {(product.price_cents / 100).toLocaleString(locale, {
                    style: "currency",
                    currency: product.currency,
                  })}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      href={`/${locale}/admin/products/${product.id}`}
                      className="text-sm font-semibold text-brand-red hover:underline"
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => handleReinstate(product)}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-green-700 hover:text-green-900 transition-colors"
                      title="Reinstate product"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reinstate
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-text-muted">
                  {localProducts.length === 0
                    ? "No archived products. Archive products from the main products list to see them here."
                    : "No products match your search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
