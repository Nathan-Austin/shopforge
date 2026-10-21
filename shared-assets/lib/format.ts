/**
 * Format utilities for consistent UI display
 */

/**
 * Format price from cents to a localized currency string
 */
export function formatPrice(
  priceCents: number,
  currency: string = 'EUR',
  locale: string = 'en'
): string {
  try {
    return (priceCents / 100).toLocaleString(locale, {
      style: 'currency',
      currency: currency,
    });
  } catch (error) {
    // Fallback if locale or currency is invalid
    return `${(priceCents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Capitalize first letter of a string
 */
export function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
