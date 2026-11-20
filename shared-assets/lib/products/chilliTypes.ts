/**
 * What a product form said about chilli types.
 *
 * One product form serves both store modes, so the save path cannot
 * assume the chilli-type control was on screen: a generic shop never
 * renders it, and a chilli shop with no types defined has nothing to
 * render. Reading "nothing submitted" as "nothing selected" is what wipes
 * a product's chilli types on save — the bug a generated chilli store
 * shipped with once — so the form sends a marker field whenever it shows
 * the control, and that marker is what decides here.
 */
export interface ChilliTypeSelection {
  /** The form carried the selection: the links may be replaced. */
  submitted: boolean;
  /** The chosen type ids, deduplicated; empty means "clear them". */
  ids: string[];
}

/** The marker a product form sends alongside its chilli-type control. */
export const CHILLI_TYPES_PRESENT = 'chilliTypesPresent';

export function chilliTypeSelection(formData: FormData): ChilliTypeSelection {
  if (!formData.has(CHILLI_TYPES_PRESENT)) return { submitted: false, ids: [] };
  const ids = formData
    .getAll('chilliTypeIds')
    .map((id) => id.toString().trim())
    .filter(Boolean);
  // The join table's primary key refuses a repeat, and a browser can send
  // one if the same option appears twice.
  return { submitted: true, ids: [...new Set(ids)] };
}
