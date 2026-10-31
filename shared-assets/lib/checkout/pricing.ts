/**
 * Shipping Pricing
 *
 * Flat-rate shipping read from lib/shipping/config.ts
 */

import { SHIPPING_CONFIG } from '../shipping/config';

export const SHIPPING_RATE_LABEL = SHIPPING_CONFIG.label;

/**
 * Shipping cost in cents for an order subtotal
 */
export function calculateShippingCost(subtotalCents: number): number {
  const threshold = SHIPPING_CONFIG.freeShippingThresholdCents;
  if (threshold !== null && subtotalCents >= threshold) {
    return 0;
  }
  return SHIPPING_CONFIG.flatRateCents;
}
