/**
 * Shipping maths.
 *
 * Pure: the shipping setting is passed in, never read here, so the same
 * functions serve any shop's rates and are tested with fixtures. Callers
 * read the setting once (getShippingSettings()) — it is the `shipping`
 * store settings key, falling back to the generated
 * src/lib/shipping/config.ts until the owner saves the section.
 */

import type { StoreSettings } from '../settings/schema';

export type ShippingSettings = StoreSettings['shipping'];

export interface OrderItem {
  quantity: number;
}

/** Shipping cost in cents for an order subtotal. */
export function calculateShippingCostOn(shipping: ShippingSettings, subtotalCents: number): number {
  const threshold = shipping.freeShippingThresholdCents;
  if (threshold !== null && subtotalCents >= threshold) {
    return 0;
  }
  return shipping.flatRateCents;
}

/** Total package weight in kilograms: the box plus every item. */
export function packageWeightOn(shipping: ShippingSettings, items: OrderItem[]): number {
  const grams = items.reduce(
    (sum, item) => sum + shipping.itemWeightGrams * item.quantity,
    shipping.boxWeightGrams
  );
  return grams / 1000;
}
