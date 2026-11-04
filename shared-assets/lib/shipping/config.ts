/**
 * Shipping Configuration
 *
 * Placeholder values: replace them with your shop's box and rates.
 */

export const SHIPPING_CONFIG = {
  /** Box dimensions in millimeters */
  box: {
    length: 300,
    width: 200,
    height: 100,
    /** Empty box weight in grams */
    weightGrams: 200,
  },
  /** Weight assumed for every item, in grams */
  itemWeightGrams: 500,
  /** Flat rate charged per order, in cents */
  flatRateCents: 500,
  /** Currency of the flat rate and the threshold, ISO 4217 */
  currency: 'EUR',
  /** Orders at or above this subtotal ship free (null to disable) */
  freeShippingThresholdCents: 5000 as number | null,
  /** Shown to the customer at checkout */
  label: 'Standard Shipping',
};

export interface OrderItem {
  quantity: number;
}

/**
 * Total package weight in kilograms
 */
export function calculatePackageWeight(items: OrderItem[]): number {
  const grams = items.reduce(
    (sum, item) => sum + SHIPPING_CONFIG.itemWeightGrams * item.quantity,
    SHIPPING_CONFIG.box.weightGrams
  );
  return grams / 1000;
}
