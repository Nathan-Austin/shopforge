"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatPrice } from "@/lib/format";
import { getEffectivePriceCents, getRegularPriceCents, isOnSale } from "@/lib/pricing";
import AddToCartButton from "./AddToCartButton";
import type { ProductVariant } from "./types";

interface ProductVariantSelectorProps {
  productId: string;
  variants: ProductVariant[];
  basePriceCents: number;
  onSale?: boolean;
  saleBasePriceCents?: number | null;
  currency: string;
  outOfStock?: boolean;
}

export default function ProductVariantSelector({
  productId,
  variants,
  basePriceCents,
  onSale = false,
  saleBasePriceCents = null,
  currency,
  outOfStock = false,
}: ProductVariantSelectorProps) {
  const locale = useLocale();
  const t = useTranslations("ProductPage");

  const activeVariants = variants;
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    activeVariants[0]?.id ?? "",
  );

  const selectedVariant = activeVariants.find((v) => v.id === selectedVariantId);
  const product = { price_cents: basePriceCents, on_sale: onSale, sale_price_cents: saleBasePriceCents };
  const displayPrice = getEffectivePriceCents(product, selectedVariant);
  const regularPrice = getRegularPriceCents(product, selectedVariant);
  const hasDiscount = isOnSale(product, selectedVariant);
  const variantOutOfStock = outOfStock || (selectedVariant ? !selectedVariant.in_stock : false);

  if (activeVariants.length === 0) {
    return (
      <AddToCartButton
        productId={productId}
        outOfStock={outOfStock}
        label={t("addToCart")}
        outOfStockLabel={t("outOfStock")}
        className="w-full sm:w-auto bg-brand-red hover:bg-brand-red/90 text-white"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {hasDiscount && (
          <span className="text-lg text-zinc-500 line-through">
            {formatPrice(regularPrice, currency, locale)}
          </span>
        )}
        <p className={`text-3xl font-bold ${hasDiscount ? "text-brand-red" : "text-foreground"}`}>
          {formatPrice(displayPrice, currency, locale)}
        </p>
        {hasDiscount && (
          <span className="bg-brand-red text-white text-xs font-bold uppercase px-2 py-1 rounded-full">
            {t("sale")}
          </span>
        )}
      </div>

      {activeVariants.length > 1 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{t("selectSize")}</p>
          <div className="flex flex-wrap gap-2">
            {activeVariants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                onClick={() => setSelectedVariantId(variant.id)}
                className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  selectedVariantId === variant.id
                    ? "border-brand-red bg-brand-red text-white"
                    : !variant.in_stock
                      ? "border-zinc-200 text-zinc-400 cursor-not-allowed opacity-60"
                      : "border-zinc-300 text-foreground hover:border-brand-red"
                }`}
                disabled={!variant.in_stock && selectedVariantId !== variant.id}
              >
                {variant.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <AddToCartButton
        productId={productId}
        variantId={selectedVariantId}
        outOfStock={variantOutOfStock}
        label={t("addToCart")}
        outOfStockLabel={t("outOfStock")}
        size="lg"
        className="w-full sm:w-auto bg-brand-red hover:bg-brand-red/90 text-white"
      />
    </div>
  );
}
