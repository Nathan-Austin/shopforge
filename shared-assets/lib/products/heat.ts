/**
 * Heat scale.
 *
 * Heat is always stored as a plain number in `products.heat_level`, on the
 * shop's own scale — the `heat` store setting, falling back to HEAT_SCALE in
 * ./config.ts. How it reads to customers — a number, a word like "Hot", or
 * both — is a display choice, so the same data can be re-presented without
 * touching rows.
 *
 * Words are optional: a shop that only uses mild/medium/hot simply has three
 * bands, and shops that want numbers only have none.
 *
 * Every function here takes the scale explicitly, so there is one source of
 * truth and no module-level copy of it: a server page or action reads it
 * once (getHeatScale()) and passes it to the components that need it.
 * Because levels are stored on the scale, changing `max` means rewriting
 * the rows — `rescaleHeat` is what does the arithmetic, and the settings
 * action is what applies it (decided 2026-11-20, option (c) of Q4 in
 * docs/single-codebase-plan.md).
 */

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

/** Every selectable level, for the admin's heat dropdown. */
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
export function heatFractionOn(
  scale: HeatScale | null,
  level: number | string | null | undefined
): number {
  const value = toLevel(level);
  if (value === null || !scale || scale.max <= 0) return 0;
  return Math.min(1, Math.max(0, value / scale.max));
}

/**
 * The same heat on a different scale, for when the owner changes `max`.
 * A level already at the top of the old scale stays at the top of the new
 * one, and anything above zero keeps at least a 1, so a mild sauce never
 * becomes a no-heat one by rounding. Returns null for a row with no heat.
 */
export function rescaleHeat(
  level: number | string | null | undefined,
  fromMax: number,
  toMax: number
): number | null {
  const value = toLevel(level);
  if (value === null || fromMax <= 0 || toMax <= 0) return null;
  if (fromMax === toMax) return Math.round(Math.min(value, toMax));

  const scaled = Math.round((Math.min(value, fromMax) / fromMax) * toMax);
  if (value > 0 && scaled === 0) return 1;
  return Math.min(scaled, toMax);
}
