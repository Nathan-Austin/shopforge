import { describe, expect, it } from 'vitest';

import { calculateShippingCostOn, packageWeightOn, type ShippingSettings } from './pricing';

const shipping: ShippingSettings = {
  flatRateCents: 500,
  freeShippingThresholdCents: 5000,
  label: 'Standard Shipping',
  itemWeightGrams: 400,
  boxWeightGrams: 250,
  homeCountry: null
};

describe('calculateShippingCostOn', () => {
  it('charges the flat rate below the free-shipping threshold', () => {
    expect(calculateShippingCostOn(shipping, 0)).toBe(500);
    expect(calculateShippingCostOn(shipping, 4999)).toBe(500);
  });

  it('ships free at or above the threshold', () => {
    expect(calculateShippingCostOn(shipping, 5000)).toBe(0);
    expect(calculateShippingCostOn(shipping, 5001)).toBe(0);
  });

  it('never ships free when the threshold is off', () => {
    const noFree = { ...shipping, freeShippingThresholdCents: null };
    expect(calculateShippingCostOn(noFree, 1_000_000)).toBe(shipping.flatRateCents);
  });
});

describe('packageWeightOn', () => {
  it('counts the box plus every item', () => {
    expect(packageWeightOn(shipping, [{ quantity: 1 }, { quantity: 2 }])).toBe((250 + 400 * 3) / 1000);
  });

  it('is just the empty box for an empty order', () => {
    expect(packageWeightOn(shipping, [])).toBe(0.25);
  });
});
