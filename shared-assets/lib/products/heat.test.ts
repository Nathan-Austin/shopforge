import { describe, expect, it } from 'vitest';

import {
  formatHeatOn,
  heatFractionOn,
  heatLevelsOn,
  heatPeppersOn,
  heatWordOn,
  type HeatScale
} from './heat';

/** A shop using the full set of words on a 0-10 scale. */
const tenPoint: HeatScale = {
  max: 10,
  display: 'both',
  bands: [
    { word: 'Mild', upTo: 3 },
    { word: 'Medium', upTo: 6 },
    { word: 'Hot', upTo: 8 },
    { word: 'Extra hot', upTo: 9 },
    { word: 'Extreme', upTo: 10 }
  ]
};

/** A shop that only talks about mild, medium and hot, on a 0-20 scale. */
const twentyPoint: HeatScale = {
  max: 20,
  display: 'word',
  bands: [
    { word: 'Mild', upTo: 5 },
    { word: 'Medium', upTo: 12 },
    { word: 'Hot', upTo: 20 }
  ]
};

/** A shop that uses numbers only. */
const numbersOnly: HeatScale = { max: 5, display: 'number', bands: [] };

describe('heatWordOn', () => {
  it('picks the band a level falls inside', () => {
    expect(heatWordOn(tenPoint, 0)).toBe('Mild');
    expect(heatWordOn(tenPoint, 5)).toBe('Medium');
    expect(heatWordOn(tenPoint, 10)).toBe('Extreme');
  });

  it('treats a band boundary as part of that band', () => {
    expect(heatWordOn(tenPoint, 3)).toBe('Mild');
    expect(heatWordOn(tenPoint, 4)).toBe('Medium');
    expect(heatWordOn(tenPoint, 6)).toBe('Medium');
    expect(heatWordOn(tenPoint, 7)).toBe('Hot');
  });

  it('works for a shop that skips the hotter words', () => {
    expect(heatWordOn(twentyPoint, 5)).toBe('Mild');
    expect(heatWordOn(twentyPoint, 13)).toBe('Hot');
    expect(heatWordOn(twentyPoint, 20)).toBe('Hot');
  });

  it('falls back to the top band when a level is above the scale', () => {
    expect(heatWordOn(tenPoint, 99)).toBe('Extreme');
  });

  it('returns null when the shop uses no words, or there is no heat', () => {
    expect(heatWordOn(numbersOnly, 3)).toBeNull();
    expect(heatWordOn(tenPoint, null)).toBeNull();
    expect(heatWordOn(tenPoint, undefined)).toBeNull();
    expect(heatWordOn(tenPoint, '')).toBeNull();
    expect(heatWordOn(null, 5)).toBeNull();
  });

  it('accepts a level that arrives as a string', () => {
    expect(heatWordOn(tenPoint, '7')).toBe('Hot');
  });
});

describe('formatHeatOn', () => {
  it('renders each display mode', () => {
    expect(formatHeatOn(tenPoint, 7, 'number')).toBe('7/10');
    expect(formatHeatOn(tenPoint, 7, 'word')).toBe('Hot');
    expect(formatHeatOn(tenPoint, 7, 'both')).toBe('Hot (7/10)');
    expect(formatHeatOn(tenPoint, 7, 'peppers')).toBe('🌶️🌶️🌶️🌶️');
  });

  it("defaults to the shop's own display setting", () => {
    expect(formatHeatOn(tenPoint, 7)).toBe('Hot (7/10)');
    expect(formatHeatOn(twentyPoint, 13)).toBe('Hot');
  });

  it('falls back to the number when there is no word for the level', () => {
    expect(formatHeatOn(numbersOnly, 2, 'word')).toBe('2/5');
    expect(formatHeatOn(numbersOnly, 2, 'both')).toBe('2/5');
  });

  it('renders zero heat rather than treating it as missing', () => {
    expect(formatHeatOn(tenPoint, 0)).toBe('Mild (0/10)');
  });

  it('is empty when there is no heat or no scale', () => {
    expect(formatHeatOn(tenPoint, null)).toBe('');
    expect(formatHeatOn(null, 5)).toBe('');
  });
});

describe('heatPeppersOn', () => {
  it('scales the icons to the shop range', () => {
    expect(heatPeppersOn(tenPoint, 10)).toBe('🌶️🌶️🌶️🌶️🌶️');
    expect(heatPeppersOn(tenPoint, 5)).toBe('🌶️🌶️🌶️');
    expect(heatPeppersOn(twentyPoint, 20)).toBe('🌶️🌶️🌶️🌶️🌶️');
  });

  it('gives any heat above zero at least one pepper', () => {
    expect(heatPeppersOn(twentyPoint, 1)).toBe('🌶️');
  });

  it('shows nothing at zero or without heat', () => {
    expect(heatPeppersOn(tenPoint, 0)).toBe('');
    expect(heatPeppersOn(tenPoint, null)).toBe('');
  });
});

describe('heatFractionOn', () => {
  it('reports where the level sits on the scale', () => {
    expect(heatFractionOn(tenPoint, 5)).toBe(0.5);
    expect(heatFractionOn(twentyPoint, 5)).toBe(0.25);
  });

  it('clamps to the 0-1 range', () => {
    expect(heatFractionOn(tenPoint, 50)).toBe(1);
    expect(heatFractionOn(tenPoint, -5)).toBe(0);
    expect(heatFractionOn(null, 5)).toBe(0);
  });
});

describe('heatLevelsOn', () => {
  it('lists every level including zero', () => {
    expect(heatLevelsOn(numbersOnly)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(heatLevelsOn(tenPoint)).toHaveLength(11);
  });

  it('is empty without a scale', () => {
    expect(heatLevelsOn(null)).toEqual([]);
  });
});
