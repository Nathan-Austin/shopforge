/**
 * Helpers for embedded (joined) rows returned by supabase-js.
 *
 * Without generated database types supabase-js can't tell a many-to-one
 * join from a one-to-many one and types every embed as an array, even for
 * `cart_items.products`. These helpers unwrap either shape.
 */

/** First (or only) row of an embedded relation, or null when missing. */
export function one<T>(relation: T | T[] | null | undefined): T | null {
  if (Array.isArray(relation)) {
    return relation[0] ?? null;
  }
  return relation ?? null;
}

/** Embedded relation as an array, whatever shape it came back in. */
export function many<T>(relation: T | T[] | null | undefined): T[] {
  if (Array.isArray(relation)) {
    return relation;
  }
  return relation ? [relation] : [];
}
