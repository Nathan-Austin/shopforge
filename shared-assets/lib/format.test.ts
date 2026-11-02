import { describe, expect, it } from 'vitest';

import { capitalize, formatPrice } from './format';

describe('formatPrice', () => {
  it('turns cents into a localised currency string', () => {
    expect(formatPrice(1250, 'EUR', 'en')).toContain('12.50');
    expect(formatPrice(0, 'EUR', 'en')).toContain('0.00');
  });

  it('falls back instead of throwing on a bad currency', () => {
    expect(formatPrice(1250, 'NOT-A-CURRENCY', 'en')).toBe('12.50 NOT-A-CURRENCY');
  });
});

describe('capitalize', () => {
  it('upper-cases the first letter and lower-cases the rest', () => {
    expect(capitalize('hOT sauce')).toBe('Hot sauce');
  });

  it('is empty for an empty string', () => {
    expect(capitalize('')).toBe('');
  });
});
