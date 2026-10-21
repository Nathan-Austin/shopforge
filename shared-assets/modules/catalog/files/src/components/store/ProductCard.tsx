"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { Star, Vegan, CandyOff } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/format";
import { getEffectivePriceCents, getRegularPriceCents, isOnSale } from "@/lib/pricing";
import AddToCartButton from "./AddToCartButton";
import type { StoreProduct } from "./types";


interface ProductCardProps {
  product: StoreProduct;
}

const getCategoryColor = (slug?: string) => {
  if (!slug) return "bg-zinc-100 text-zinc-800 border-zinc-200";

  const colors: Record<string, string> = {
    // Heat bands
    mild: "bg-lime-100 text-lime-800 border-lime-200",
    medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
    hot: "bg-orange-100 text-orange-800 border-orange-200",
    "very-hot": "bg-red-100 text-red-800 border-red-200",
    superhot: "bg-rose-100 text-rose-800 border-rose-200",
    // Product types
    "chili-challenges": "bg-purple-100 text-purple-800 border-purple-200",
    "chili-extracts": "bg-rose-100 text-rose-800 border-rose-200",
    "chili-oils": "bg-yellow-100 text-yellow-800 border-yellow-200",
    "chili-chocolate": "bg-stone-100 text-stone-800 border-stone-200",
    "dried-chili-pods-powders-flakes":
      "bg-emerald-100 text-emerald-800 border-emerald-200",
    "gift-boxes-sets": "bg-blue-100 text-blue-800 border-blue-200",
    "hot-honey": "bg-amber-100 text-amber-800 border-amber-200",
    "hot-salt": "bg-cyan-100 text-cyan-800 border-cyan-200",
    "seasonings-rubs": "bg-teal-100 text-teal-800 border-teal-200",
    "spicy-chips-nuts-candy": "bg-violet-100 text-violet-800 border-violet-200",
    merchandise: "bg-indigo-100 text-indigo-800 border-indigo-200",
  };

  return colors[slug] || "bg-zinc-100 text-zinc-800 border-zinc-200";
};

export default function ProductCard({
  product,
}: ProductCardProps) {
  const locale = useLocale();
  const t = useTranslations("ProductPage");

  const activeVariants = product.variants ?? [];
  const hasVariants = activeVariants.length > 1;

  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    activeVariants[0]?.id ?? "",
  );
  const selectedVariant = hasVariants
    ? activeVariants.find((v) => v.id === selectedVariantId)
    : null;

  const displayPrice = getEffectivePriceCents(product, selectedVariant);
  const regularPrice = getRegularPriceCents(product, selectedVariant);
  const lowestVariantPrice = hasVariants
    ? Math.min(...activeVariants.map((v) => getEffectivePriceCents(product, v)))
    : null;
  const hasDiscount =
    (!hasVariants || !!selectedVariant) && isOnSale(product, selectedVariant);
  const productUrl = `/${locale}/shop/${product.slug}`;
  const outOfStock = hasVariants
    ? selectedVariant ? !selectedVariant.in_stock : false
    : !(product.in_stock ?? true);

  return (
    <Card className="group overflow-hidden transition-all hover:shadow-lg h-full flex flex-col">
      <CardHeader className="p-0">
        <Link href={productUrl} className="block">
          <div className="relative aspect-square w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
            {product.image_url ? (
              <Image
                src={product.image_url}
                alt={product.name}
                fill
                className={`object-contain p-4 transition-transform group-hover:scale-105 ${outOfStock ? "opacity-50" : ""}`}
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-zinc-300">
                <span className="text-4xl">🌶️</span>
              </div>
            )}
            {outOfStock && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="bg-zinc-800/70 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  {t("outOfStock")}
                </span>
              </div>
            )}
            {hasDiscount && (
              <div className="absolute top-2 right-2">
                <span className="bg-brand-red text-white text-xs font-bold uppercase px-2 py-1 rounded-full shadow-sm">
                  {t("sale")}
                </span>
              </div>
            )}
            {(product.is_vegan || product.is_sugar_free) && (
              <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
                {product.is_vegan && (
                  <span className="flex items-center gap-1 bg-green-600 text-white text-xs font-semibold px-2 py-1 rounded-full shadow-sm">
                    <Vegan size={12} />
                    {t("vegan")}
                  </span>
                )}
                {product.is_sugar_free && (
                  <span className="flex items-center gap-1 bg-orange-600 text-white text-xs font-semibold px-2 py-1 rounded-full shadow-sm">
                    <CandyOff size={12} />
                    {t("sugarFree")}
                  </span>
                )}
              </div>
            )}
          </div>
        </Link>
      </CardHeader>
      <CardContent className="p-4 flex flex-col flex-1">
        <div className="space-y-2 flex-1">
          <Link href={productUrl} className="block">
            <h3 className="text-lg font-semibold line-clamp-2 group-hover:text-orange-600 transition-colors">
              {product.name}
            </h3>
          </Link>

          {product.description && (
            <p className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
              {product.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()}
            </p>
          )}
        </div>

        {(product.reviewCount ?? 0) > 0 && (
          <div className="flex items-center gap-1.5 mt-2">
            <div className="flex text-orange-400">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  size={13}
                  fill={i < Math.round(product.avgRating ?? 0) ? "currentColor" : "none"}
                  className={i < Math.round(product.avgRating ?? 0) ? "" : "text-zinc-200"}
                />
              ))}
            </div>
            <span className="text-xs text-zinc-500">({product.reviewCount})</span>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 shrink-0">
            {hasDiscount && (
              <span className="text-sm text-zinc-500 line-through">
                {formatPrice(regularPrice, product.currency, locale)}
              </span>
            )}
            <span
              className={`text-lg font-bold ${hasDiscount ? "text-brand-red" : ""}`}
            >
              {hasVariants && !selectedVariant
                ? `${t("from")} ${formatPrice(lowestVariantPrice!, product.currency, locale)}`
                : formatPrice(displayPrice, product.currency, locale)}
            </span>
          </div>
          {product.category && (
            <Badge
              variant="outline"
              className={`font-normal border min-w-0 truncate ${getCategoryColor(product.category.slug)}`}
            >
              {product.category.name}
            </Badge>
          )}
        </div>

        {hasVariants && (
          <div className="mt-2 flex flex-wrap gap-1">
            {activeVariants.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedVariantId(v.id)}
                className={`px-2 py-0.5 rounded text-xs font-medium border transition-all ${
                  selectedVariantId === v.id
                    ? "border-brand-red bg-brand-red text-white"
                    : !v.in_stock
                      ? "border-zinc-200 text-zinc-400 opacity-60"
                      : "border-zinc-300 text-zinc-700 hover:border-brand-red"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <AddToCartButton
            productId={String(product.id)}
            variantId={hasVariants ? selectedVariantId : undefined}
            outOfStock={outOfStock}
            label={t("addToCart")}
            outOfStockLabel={t("outOfStock")}
            size="sm"
            variant="outline"
            className="flex-1 border-brand-black text-brand-black hover:bg-brand-black hover:text-white"
          />
          {!outOfStock && (
            <AddToCartButton
              productId={String(product.id)}
              variantId={hasVariants ? selectedVariantId : undefined}
              label={t("buyNow")}
              size="sm"
              className="flex-1 bg-brand-red hover:bg-brand-red/90 text-white"
              redirectTo={`/${locale}/checkout`}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
