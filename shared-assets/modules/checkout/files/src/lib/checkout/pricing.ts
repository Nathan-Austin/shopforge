/**
 * Shipping Pricing Logic
 *
 * Calculate shipping costs based on destination and weight
 */

export const SHIPPING_RATE_LABEL = "Shipping";

/** VAT rate included in prices (6%, a common reduced food rate). Set it for your country. */
export const STANDARD_TAX_RATE = 0.06;

// ==================== SHIPPING ZONES ====================
//
// Zone data is now admin-editable (supabase/migrations/0179_shipping_zones.sql,
// managed from /admin/shipping) rather than hardcoded here. Shapes below
// match what src/lib/checkout/shipping-zones.ts fetches and assembles.

export interface WeightBracket {
  /** Inclusive upper bound in kg. null = no upper bound (catch-all bracket). */
  maxWeightKg: number | null;
  priceCents: number;
}

export interface ShippingZone {
  id: string;
  name: string;
  isDefault: boolean;
  countryCodes: string[];
  brackets: WeightBracket[];
  freeShippingThresholdCents?: number | null;
}

function findZoneForCountry(
  countryCode: string,
  zones: ShippingZone[],
): ShippingZone | undefined {
  const c = countryCode.toUpperCase();
  return (
    zones.find((zone) => zone.countryCodes.includes(c)) ??
    zones.find((zone) => zone.isDefault)
  );
}

// ==================== CALCULATION ====================

/**
 * Calculate total shipping cost in cents.
 * Brackets use inclusive upper bounds (≤ maxWeightKg); a null maxWeightKg
 * bracket is the catch-all for anything heavier than the other brackets.
 */
export function calculateShippingCost(
  countryCode: string,
  weightKg: number,
  subtotalCents: number = 0,
  zones: ShippingZone[] = [],
): number {
  const zone = findZoneForCountry(countryCode, zones);
  if (!zone || zone.brackets.length === 0) return 0;

  if (
    zone.freeShippingThresholdCents != null &&
    subtotalCents >= zone.freeShippingThresholdCents
  ) {
    return 0;
  }

  const sorted = [...zone.brackets].sort((a, b) => {
    if (a.maxWeightKg == null) return 1;
    if (b.maxWeightKg == null) return -1;
    return a.maxWeightKg - b.maxWeightKg;
  });

  const bracket =
    sorted.find((b) => b.maxWeightKg != null && weightKg <= b.maxWeightKg) ??
    sorted[sorted.length - 1];

  return bracket.priceCents;
}

// ==================== TAX ====================

/**
 * Extract the tax portion from a VAT-inclusive total (STANDARD_TAX_RATE)
 */
export function calculateTaxFromTotal(
  totalCents: number,
  taxRate: number = STANDARD_TAX_RATE,
): number {
  return Math.round(totalCents - totalCents / (1 + taxRate));
}

export function calculateNetAmount(
  totalCents: number,
  taxRate: number = STANDARD_TAX_RATE,
): number {
  return Math.round(totalCents / (1 + taxRate));
}
