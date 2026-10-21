/**
 * Format utilities for consistent UI display
 */

/**
 * Format price from cents to a localized currency string
 */
export function formatPrice(
  priceCents: number,
  currency: string = "EUR",
  locale: string = "en",
): string {
  try {
    return (priceCents / 100).toLocaleString(locale, {
      style: "currency",
      currency: currency,
    });
  } catch (error) {
    // Fallback if locale or currency is invalid
    return `${(priceCents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Format a product's volume using its preferred display unit (ml or g).
 * Falls back to whichever field is populated if display_unit is unset.
 */
export function formatVolume(product: {
  capacity_ml?: number | null;
  weight_grams?: number | null;
  display_unit?: string | null;
}): string | null {
  const unit = product.display_unit === "g" ? "g" : "ml";
  if (unit === "g") {
    if (product.weight_grams) return `${product.weight_grams} g`;
    if (product.capacity_ml) return `${product.capacity_ml} ml`;
    return null;
  }
  if (product.capacity_ml) return `${product.capacity_ml} ml`;
  if (product.weight_grams) return `${product.weight_grams} g`;
  return null;
}

/**
 * Capitalize first letter of a string
 */
export function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
