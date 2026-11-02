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

/*
 * The `*On` functions take the scale explicitly so they can be reasoned
 * about (and tested) for any shop's settings. The exported wrappers below
 * use this shop's configured scale, which is what components should call.
 */

/** True for shops that track heat at all (the chilli store mode). */
export function hasHeatScale(): boolean {
  return heatScale !== null;
}

/** Every selectable level, for admin dropdowns. */
export function heatLevels(): number[] {
  return heatLevelsOn(heatScale);
}

export function heatLevelsOn(scale: HeatScale | null): number[] {
  if (!scale || scale.max < 0) return [];
  return Array.from({ length: scale.max + 1 }, (_, index) => index);
}

function toLevel(level: number | string | null | undefined): number | null {
  if (level === null || level === undefined || level === '') return null;
  const parsed = Number(level);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The word covering this level, or null when the shop uses no words. */
export function heatWord(level: number | string | null | undefined): string | null {
  return heatWordOn(heatScale, level);
}

export function heatWordOn(
  scale: HeatScale | null,
  level: number | string | null | undefined
): string | null {
  const value = toLevel(level);
  if (value === null || !scale || scale.bands.length === 0) return null;

  // Bands are ascending, so the first one the level fits inside wins.
  const band =
    scale.bands.find((candidate) => value <= candidate.upTo) ??
    scale.bands[scale.bands.length - 1];

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
  return formatHeatOn(heatScale, level, display);
}

export function formatHeatOn(
  scale: HeatScale | null,
  level: number | string | null | undefined,
  display: HeatDisplay = scale?.display ?? 'number'
): string {
  const value = toLevel(level);
  if (value === null || !scale) return '';

  const word = heatWordOn(scale, value);
  const numeric = `${value}/${scale.max}`;

  switch (display) {
    case 'number':
      return numeric;
    case 'word':
      return word ?? numeric;
    case 'peppers':
      return heatPeppersOn(scale, value);
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
  return heatPeppersOn(heatScale, level, outOf);
}

export function heatPeppersOn(
  scale: HeatScale | null,
  level: number | string | null | undefined,
  outOf = 5
): string {
  const value = toLevel(level);
  if (value === null || !scale || scale.max <= 0) return '';
  // Anything above zero gets at least one pepper, so a 1/20 sauce still
  // reads as mildly hot rather than as no heat at all.
  const filled = Math.max(
    value > 0 ? 1 : 0,
    Math.round((value / scale.max) * outOf)
  );
  return '🌶️'.repeat(filled);
}

/** Fraction of the scale, for progress bars. 0 to 1. */
export function heatFraction(level: number | string | null | undefined): number {
  return heatFractionOn(heatScale, level);
}

export function heatFractionOn(
  scale: HeatScale | null,
  level: number | string | null | undefined
): number {
  const value = toLevel(level);
  if (value === null || !scale || scale.max <= 0) return 0;
  return Math.min(1, Math.max(0, value / scale.max));
}
