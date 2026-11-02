import { describe, expect, it } from 'vitest';

import { SHIPPING_CONFIG, calculatePackageWeight } from '../shipping/config';
import { calculateShippingCost } from './pricing';

describe('calculateShippingCost', () => {
  const threshold = SHIPPING_CONFIG.freeShippingThresholdCents;

  it('charges the flat rate below the free-shipping threshold', () => {
    expect(calculateShippingCost(0)).toBe(SHIPPING_CONFIG.flatRateCents);
  });

  it('ships free at or above the threshold', () => {
    if (threshold === null) return;
    expect(calculateShippingCost(threshold)).toBe(0);
    expect(calculateShippingCost(threshold + 1)).toBe(0);
    expect(calculateShippingCost(threshold - 1)).toBe(SHIPPING_CONFIG.flatRateCents);
  });
});

describe('calculatePackageWeight', () => {
  it('counts the box plus every item', () => {
    const expected =
      (SHIPPING_CONFIG.box.weightGrams + SHIPPING_CONFIG.itemWeightGrams * 3) / 1000;
    expect(calculatePackageWeight([{ quantity: 1 }, { quantity: 2 }])).toBe(expected);
  });

  it('is just the empty box for an empty order', () => {
    expect(calculatePackageWeight([])).toBe(SHIPPING_CONFIG.box.weightGrams / 1000);
  });
});
