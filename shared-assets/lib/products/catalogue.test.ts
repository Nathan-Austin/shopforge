import { describe, expect, it } from 'vitest';

import {
  PRODUCT_FIELDS,
  PRODUCT_FIELD_GROUPS,
  parseProductFieldsFor,
  productSelectColumns,
  type ProductField
} from './catalogue';

function field(key: string): ProductField {
  const found = PRODUCT_FIELDS.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`No such product field: ${key}`);
  return found;
}

function form(values: Record<string, string | string[]>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      formData.append(key, entry);
    }
  }
  return formData;
}

function parse(keys: string[], values: Record<string, string | string[]>) {
  return parseProductFieldsFor(keys.map(field), form(values));
}

describe('the catalogue itself', () => {
  it('has unique keys and columns', () => {
    const keys = PRODUCT_FIELDS.map((entry) => entry.key);
    const columns = PRODUCT_FIELDS.map((entry) => entry.column);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(columns).size).toBe(columns.length);
  });

  it('puts every field in a known group', () => {
    const groups = new Set(PRODUCT_FIELD_GROUPS.map((entry) => entry.key));
    for (const entry of PRODUCT_FIELDS) {
      expect(groups, `${entry.key} has an unknown group`).toContain(entry.group);
    }
  });

  it('gives every choice-based field its options', () => {
    for (const entry of PRODUCT_FIELDS) {
      if (entry.type === 'multiSelect' || entry.type === 'measure') {
        expect(entry.options?.length, `${entry.key} needs options`).toBeTruthy();
      }
      if (entry.type === 'measure') {
        expect(entry.unitColumn, `${entry.key} needs a unitColumn`).toBeTruthy();
      }
    }
  });
});

describe('parseProductFieldsFor', () => {
  it('only touches the fields it is given', () => {
    const row = parse(['sku'], { sku: 'ABC-1', stock: '12' });
    expect(row).toEqual({ sku: 'ABC-1' });
  });

  it('stores money in cents', () => {
    expect(parse(['compare_at_price'], { compare_at_price: '12.50' })).toEqual({
      compare_at_price_cents: 1250
    });
  });

  it('rounds fractional cents rather than truncating', () => {
    expect(parse(['compare_at_price'], { compare_at_price: '0.125' })).toEqual({
      compare_at_price_cents: 13
    });
  });

  it('treats blank input as null, not zero', () => {
    expect(parse(['stock'], { stock: '' })).toEqual({ stock: null });
    expect(parse(['sku'], { sku: '   ' })).toEqual({ sku: null });
  });

  it('reads an unchecked box as false and a ticked one as true', () => {
    expect(parse(['is_active'], {})).toEqual({ is_active: false });
    expect(parse(['is_active'], { is_active: 'on' })).toEqual({ is_active: true });
  });

  it('turns the archived checkbox into a timestamp', () => {
    expect(parse(['archived'], {})).toEqual({ archived_at: null });
    const row = parse(['archived'], { archived: 'on' });
    expect(typeof row.archived_at).toBe('string');
    expect(Number.isNaN(Date.parse(row.archived_at as string))).toBe(false);
  });

  it('splits comma or newline separated lists and drops the blanks', () => {
    expect(parse(['tags'], { tags: 'hot, smoky ,, \nbbq ' })).toEqual({
      tags: ['hot', 'smoky', 'bbq']
    });
    expect(parse(['tags'], { tags: ' , ' })).toEqual({ tags: null });
  });

  it('collects every ticked box of a multi-select', () => {
    expect(parse(['dietary_flags'], { dietary_flags: ['vegan', 'organic'] })).toEqual({
      dietary_flags: ['vegan', 'organic']
    });
    expect(parse(['dietary_flags'], {})).toEqual({ dietary_flags: null });
  });

  it('keeps a measurement and its unit together', () => {
    expect(parse(['net_content'], { net_content: '250', net_content_unit: 'ml' })).toEqual({
      net_content: 250,
      net_content_unit: 'ml'
    });
  });

  it('keeps only the nutrition values that were filled in', () => {
    expect(parse(['nutrition_info'], { energy_kcal: '120', salt_g: '1.2' })).toEqual({
      nutrition_info: { energy_kcal: 120, salt_g: 1.2 }
    });
    expect(parse(['nutrition_info'], {})).toEqual({ nutrition_info: null });
  });

  it('gathers the three dimensions into one value', () => {
    expect(
      parse(['dimensions'], {
        dimensions_length: '300',
        dimensions_width: '200',
        dimensions_height: '100'
      })
    ).toEqual({ dimensions_mm: { length: 300, width: 200, height: 100 } });
  });

  it('rounds whole-number fields', () => {
    expect(parse(['stock'], { stock: '4.6' })).toEqual({ stock: 5 });
  });

  it('ignores text that is not a number', () => {
    expect(parse(['stock'], { stock: 'lots' })).toEqual({ stock: null });
  });
});

describe('productSelectColumns', () => {
  it('always includes the core columns', () => {
    const columns = productSelectColumns();
    for (const column of ['id', 'name', 'slug', 'price_cents', 'currency']) {
      expect(columns).toContain(column);
    }
  });

  it('has no duplicates', () => {
    const columns = productSelectColumns();
    expect(new Set(columns).size).toBe(columns.length);
  });
});
