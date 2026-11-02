import { describe, expect, it } from 'vitest';

import {
  calculateCartTotals,
  cartLineKey,
  clampQuantity,
  maxAllowedQuantity
} from './pricing';

describe('maxAllowedQuantity', () => {
  it('is unlimited when the shop does not track inventory', () => {
    expect(maxAllowedQuantity({ trackInventory: false, stock: 2 })).toBe(Infinity);
    expect(maxAllowedQuantity({})).toBe(Infinity);
  });

  it('is the stock on hand when tracking without backorders', () => {
    expect(maxAllowedQuantity({ trackInventory: true, stock: 3 })).toBe(3);
  });

  it('is unlimited when backorders are allowed, even at zero stock', () => {
    expect(
      maxAllowedQuantity({ trackInventory: true, stock: 0, allowBackorder: true })
    ).toBe(Infinity);
  });

  it('applies a per-order cap on its own', () => {
    expect(maxAllowedQuantity({ maxOrderQuantity: 4 })).toBe(4);
  });

  it('takes whichever limit is tighter', () => {
    expect(
      maxAllowedQuantity({ trackInventory: true, stock: 10, maxOrderQuantity: 4 })
    ).toBe(4);
    expect(
      maxAllowedQuantity({ trackInventory: true, stock: 2, maxOrderQuantity: 4 })
    ).toBe(2);
  });

  it('caps backorders at the per-order maximum', () => {
    expect(
      maxAllowedQuantity({
        trackInventory: true,
        stock: 0,
        allowBackorder: true,
        maxOrderQuantity: 5
      })
    ).toBe(5);
  });

  it('treats missing stock as none when tracking', () => {
    expect(maxAllowedQuantity({ trackInventory: true, stock: null })).toBe(0);
  });
});

describe('clampQuantity', () => {
  it('passes a quantity that is within the limits straight through', () => {
    expect(clampQuantity(2, { trackInventory: true, stock: 5 })).toEqual({
      quantity: 2,
      clamped: false,
      reason: 'ok'
    });
  });

  it('cuts the request down to the stock on hand', () => {
    expect(clampQuantity(10, { trackInventory: true, stock: 3 })).toEqual({
      quantity: 3,
      clamped: true,
      reason: 'stock'
    });
  });

  it('allows the exact stock on hand without flagging it', () => {
    expect(clampQuantity(3, { trackInventory: true, stock: 3 })).toEqual({
      quantity: 3,
      clamped: false,
      reason: 'ok'
    });
  });

  it('refuses anything when tracked, out of stock and no backorders', () => {
    expect(clampQuantity(1, { trackInventory: true, stock: 0 })).toEqual({
      quantity: 0,
      clamped: true,
      reason: 'out_of_stock'
    });
  });

  it('allows ordering past zero stock when backorders are on', () => {
    expect(
      clampQuantity(5, { trackInventory: true, stock: 0, allowBackorder: true })
    ).toEqual({ quantity: 5, clamped: false, reason: 'ok' });
  });

  it('reports the per-order cap separately from stock', () => {
    expect(
      clampQuantity(9, { trackInventory: true, stock: 100, maxOrderQuantity: 4 })
    ).toEqual({ quantity: 4, clamped: true, reason: 'max_order' });
  });

  it('treats zero and negative requests as removing the line', () => {
    expect(clampQuantity(0, {})).toEqual({ quantity: 0, clamped: false, reason: 'ok' });
    expect(clampQuantity(-3, {})).toEqual({ quantity: 0, clamped: false, reason: 'ok' });
  });

  it('ignores fractions rather than inventing stock', () => {
    expect(clampQuantity(2.9, {}).quantity).toBe(2);
    expect(clampQuantity(0.5, {}).quantity).toBe(0);
  });

  it('survives rubbish input', () => {
    expect(clampQuantity(Number.NaN, {}).quantity).toBe(0);
  });
});

describe('calculateCartTotals', () => {
  it('adds up units and money', () => {
    expect(
      calculateCartTotals([
        { quantity: 2, unitPriceCents: 500 },
        { quantity: 1, unitPriceCents: 1250 }
      ])
    ).toEqual({ lineCount: 2, itemCount: 3, subtotalCents: 2250 });
  });

  it('is all zeros for an empty cart', () => {
    expect(calculateCartTotals([])).toEqual({
      lineCount: 0,
      itemCount: 0,
      subtotalCents: 0
    });
  });

  it('never lets a negative quantity reduce the subtotal', () => {
    expect(
      calculateCartTotals([
        { quantity: -2, unitPriceCents: 500 },
        { quantity: 1, unitPriceCents: 500 }
      ])
    ).toEqual({ lineCount: 2, itemCount: 1, subtotalCents: 500 });
  });

  it('keeps money in whole cents', () => {
    const totals = calculateCartTotals([{ quantity: 3, unitPriceCents: 333 }]);
    expect(totals.subtotalCents).toBe(999);
    expect(Number.isInteger(totals.subtotalCents)).toBe(true);
  });
});

describe('cartLineKey', () => {
  it('separates the same product in different variants', () => {
    expect(cartLineKey('p1', 'S', 'Red')).not.toBe(cartLineKey('p1', 'M', 'Red'));
    expect(cartLineKey('p1', 'S', 'Red')).not.toBe(cartLineKey('p1', 'S', 'Blue'));
  });

  it('treats a missing variant the same as an empty one', () => {
    expect(cartLineKey('p1', null, null)).toBe(cartLineKey('p1', '', ''));
    expect(cartLineKey('p1')).toBe(cartLineKey('p1', null, null));
  });
});
