export interface PricedProduct {
  price_cents: number;
  on_sale?: boolean | null;
  sale_price_cents?: number | null;
}

export interface PricedVariant {
  price_cents: number;
  sale_price_cents?: number | null;
}

/** The price that should actually be charged/displayed, accounting for an active sale. */
export function getEffectivePriceCents(
  product: PricedProduct,
  variant?: PricedVariant | null,
): number {
  if (variant) {
    if (product.on_sale && variant.sale_price_cents != null) {
      return variant.sale_price_cents;
    }
    return variant.price_cents;
  }
  if (product.on_sale && product.sale_price_cents != null) {
    return product.sale_price_cents;
  }
  return product.price_cents;
}

/** The pre-sale price, for strikethrough display. */
export function getRegularPriceCents(
  product: PricedProduct,
  variant?: PricedVariant | null,
): number {
  return variant ? variant.price_cents : product.price_cents;
}

export function isOnSale(
  product: PricedProduct,
  variant?: PricedVariant | null,
): boolean {
  return getEffectivePriceCents(product, variant) < getRegularPriceCents(product, variant);
}
