/**
 * Shipping configuration: what this shop starts with.
 *
 * Placeholder values. This is the fallback, not the live setting: the
 * Shipping section of /admin/settings writes a store_settings row, and
 * from the moment the owner saves it that row decides (src/lib/settings/).
 * The shipping maths lives in lib/checkout/pricing.ts and takes the
 * setting as an argument. Only the box *weight* is a setting; the box
 * dimensions below are read by nothing yet and wait for a carrier
 * integration. The currency stays here until it is a shop setting (5b).
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
