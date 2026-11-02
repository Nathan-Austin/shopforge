/**
 * Heat scale.
 *
 * Heat is always stored as a plain number in `products.heat_level`, on the
 * scale chosen when the shop was generated (see HEAT_SCALE in ./config.ts).
 * How it reads to customers — a number, a word like "Hot", or both — is a
 * display choice, so the same data can be re-presented without touching rows.
 *
 * Words are optional: a shop that only uses mild/medium/hot simply has three
 * bands, and shops that want numbers only have none.
 */

import { HEAT_SCALE } from './config';

export interface HeatBand {
  /** Shown to the customer, e.g. "Extra hot". */
  word: string;
  /** Highest numeric level this word covers. */
  upTo: number;
}

export type HeatDisplay = 'number' | 'word' | 'both' | 'peppers';

export interface HeatScale {
  /** Top of the scale; the scale always starts at 0. */
  max: number;
  /** Default presentation in the storefront. */
  display: HeatDisplay;
  /** Ascending bands. May be empty when the shop uses numbers only. */
  bands: HeatBand[];
}

export const heatScale: HeatScale | null = HEAT_SCALE;

/** True for shops that track heat at all (the chilli store mode). */
export function hasHeatScale(): boolean {
  return heatScale !== null;
}

/** Every selectable level, for admin dropdowns. */
export function heatLevels(): number[] {
  if (!heatScale) return [];
  return Array.from({ length: heatScale.max + 1 }, (_, index) => index);
}

function toLevel(level: number | string | null | undefined): number | null {
  if (level === null || level === undefined || level === '') return null;
  const parsed = Number(level);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The word covering this level, or null when the shop uses no words. */
export function heatWord(level: number | string | null | undefined): string | null {
  const value = toLevel(level);
  if (value === null || !heatScale || heatScale.bands.length === 0) return null;

  const band =
    heatScale.bands.find((candidate) => value <= candidate.upTo) ??
    heatScale.bands[heatScale.bands.length - 1];

  return band ? band.word : null;
}

/**
 * Heat as a display string, e.g. "7/10", "Hot" or "Hot (7/10)".
 * Returns an empty string when the product has no heat set.
 */
export function formatHeat(
  level: number | string | null | undefined,
  display: HeatDisplay = heatScale?.display ?? 'number'
): string {
  const value = toLevel(level);
  if (value === null || !heatScale) return '';

  const word = heatWord(value);
  const numeric = `${value}/${heatScale.max}`;

  switch (display) {
    case 'number':
      return numeric;
    case 'word':
      return word ?? numeric;
    case 'peppers':
      return heatPeppers(value);
    case 'both':
    default:
      return word ? `${word} (${numeric})` : numeric;
  }
}

/**
 * Chilli icons scaled to the shop's range, always out of five so the row
 * stays a sensible width whatever the scale is.
 */
export function heatPeppers(level: number | string | null | undefined, outOf = 5): string {
  const value = toLevel(level);
  if (value === null || !heatScale || heatScale.max <= 0) return '';
  const filled = Math.max(
    value > 0 ? 1 : 0,
    Math.round((value / heatScale.max) * outOf)
  );
  return '🌶️'.repeat(filled);
}

/** Fraction of the scale, for progress bars. 0 to 1. */
export function heatFraction(level: number | string | null | undefined): number {
  const value = toLevel(level);
  if (value === null || !heatScale || heatScale.max <= 0) return 0;
  return Math.min(1, Math.max(0, value / heatScale.max));
}
