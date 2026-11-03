import { describe, expect, it } from 'vitest';

import {
  cleanList,
  formatDimensions,
  formatMeasure,
  formatWeight,
  galleryImages,
  hasSaving,
  nutritionRows,
  quantityLimit,
  stockRulesOf,
  stockStatus
} from './detail';

describe('stockStatus', () => {
  it('is in stock when the shop does not track inventory, whatever the count', () => {
    expect(stockStatus({ trackInventory: false, stock: 0 })).toEqual({ kind: 'in_stock' });
    expect(stockStatus({})).toEqual({ kind: 'in_stock' });
  });

  it('is sold out at zero stock without backorders', () => {
    expect(stockStatus({ trackInventory: true, stock: 0 })).toEqual({ kind: 'sold_out' });
    expect(stockStatus({ trackInventory: true, stock: null })).toEqual({ kind: 'sold_out' });
    expect(stockStatus({ trackInventory: true, stock: -3 })).toEqual({ kind: 'sold_out' });
  });

  it('offers a backorder at zero stock when the shop allows it', () => {
    expect(
      stockStatus({ trackInventory: true, stock: 0, allowBackorder: true })
    ).toEqual({ kind: 'backorder' });
  });

  it('says how many are left when stock is low', () => {
    expect(stockStatus({ trackInventory: true, stock: 5 })).toEqual({
      kind: 'low_stock',
      remaining: 5
    });
    expect(stockStatus({ trackInventory: true, stock: 1 })).toEqual({
      kind: 'low_stock',
      remaining: 1
    });
  });

  it('is plainly in stock above the low-stock threshold', () => {
    expect(stockStatus({ trackInventory: true, stock: 6 })).toEqual({ kind: 'in_stock' });
    expect(stockStatus({ trackInventory: true, stock: 6 }, 10)).toEqual({
      kind: 'low_stock',
      remaining: 6
    });
  });

  it('ignores the per-order maximum', () => {
    expect(
      stockStatus({ trackInventory: true, stock: 50, maxOrderQuantity: 2 })
    ).toEqual({ kind: 'in_stock' });
  });
});

describe('quantityLimit', () => {
  it('is null when nothing limits the quantity', () => {
    expect(quantityLimit({})).toBeNull();
    expect(quantityLimit({ trackInventory: true, stock: 0, allowBackorder: true })).toBeNull();
  });

  it('is the tighter of stock and the per-order maximum', () => {
    expect(quantityLimit({ trackInventory: true, stock: 3 })).toBe(3);
    expect(quantityLimit({ trackInventory: true, stock: 30, maxOrderQuantity: 4 })).toBe(4);
  });

  it('is zero when the product cannot be added', () => {
    expect(quantityLimit({ trackInventory: true, stock: 0 })).toBe(0);
  });
});

describe('stockRulesOf', () => {
  it('maps the view columns onto the cart rules', () => {
    expect(
      stockRulesOf({
        stock: 4,
        track_inventory: true,
        allow_backorder: false,
        max_order_quantity: 2
      })
    ).toEqual({ stock: 4, trackInventory: true, allowBackorder: false, maxOrderQuantity: 2 });
  });
});

describe('galleryImages', () => {
  it('puts the main image first and the extras after it', () => {
    expect(galleryImages('a.jpg', ['b.jpg', 'c.jpg'])).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('drops blanks and repeats', () => {
    expect(galleryImages('a.jpg', ['a.jpg', '', '  ', null, 'b.jpg', 'b.jpg'])).toEqual([
      'a.jpg',
      'b.jpg'
    ]);
  });

  it('is empty when the product has no images at all', () => {
    expect(galleryImages(null, null)).toEqual([]);
    expect(galleryImages('', [])).toEqual([]);
  });

  it('still works with only gallery images and no main one', () => {
    expect(galleryImages(null, ['b.jpg'])).toEqual(['b.jpg']);
  });
});

describe('formatMeasure', () => {
  it('joins amount and unit', () => {
    expect(formatMeasure(250, 'ml', 'en')).toBe('250 ml');
  });

  it('parses numeric strings, which is how PostgREST returns numerics', () => {
    expect(formatMeasure('1.50', 'kg', 'en')).toBe('1.5 kg');
  });

  it('uses the locale number style', () => {
    expect(formatMeasure(1.5, 'l', 'de')).toBe('1,5 l');
  });

  it('returns null without an amount, and the bare number without a unit', () => {
    expect(formatMeasure(null, 'ml', 'en')).toBeNull();
    expect(formatMeasure('', 'ml', 'en')).toBeNull();
    expect(formatMeasure(12, null, 'en')).toBe('12');
  });
});

describe('formatWeight', () => {
  it('shows grams under a kilo and kilograms from there', () => {
    expect(formatWeight(180, 'en')).toBe('180 g');
    expect(formatWeight(1000, 'en')).toBe('1 kg');
    expect(formatWeight(1250, 'en')).toBe('1.25 kg');
  });

  it('returns null for nothing or a non-positive weight', () => {
    expect(formatWeight(null, 'en')).toBeNull();
    expect(formatWeight(0, 'en')).toBeNull();
  });
});

describe('formatDimensions', () => {
  it('needs all three sides', () => {
    expect(formatDimensions({ length: 120, width: 60, height: 60 }, 'en')).toBe(
      '120 × 60 × 60 mm'
    );
    expect(formatDimensions({ length: 120, width: 60 }, 'en')).toBeNull();
    expect(formatDimensions(null, 'en')).toBeNull();
  });
});

describe('nutritionRows', () => {
  it('keeps catalogue order and skips missing values', () => {
    expect(
      nutritionRows({ salt_g: 1.2, energy_kcal: 45, fat_g: 'not a number' }, 'en')
    ).toEqual([
      { key: 'energy_kcal', value: '45' },
      { key: 'salt_g', value: '1.2' }
    ]);
  });

  it('is empty without data', () => {
    expect(nutritionRows(null, 'en')).toEqual([]);
    expect(nutritionRows({}, 'en')).toEqual([]);
  });
});

describe('cleanList', () => {
  it('trims, drops blanks and de-duplicates', () => {
    expect(cleanList([' vegan ', '', 'vegan', null, 'hot'])).toEqual(['vegan', 'hot']);
    expect(cleanList(null)).toEqual([]);
  });
});

describe('hasSaving', () => {
  it('is only true when the old price was higher', () => {
    expect(hasSaving(900, 1200)).toBe(true);
    expect(hasSaving(900, 900)).toBe(false);
    expect(hasSaving(900, 500)).toBe(false);
    expect(hasSaving(900, null)).toBe(false);
  });
});
