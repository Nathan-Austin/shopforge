import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getLocalizedField<T extends Record<string, unknown>>(
  obj: T | null | undefined,
  field: string,
  locale: string,
): string {
  if (!obj) return "";

  const localizedKey = `${field}_${locale}`;
  const localizedVal = obj[localizedKey];

  if (
    localizedVal &&
    typeof localizedVal === "string" &&
    localizedVal.trim() !== ""
  ) {
    return localizedVal;
  }

  // Fallback to the base field (e.g., description)
  if (obj[field] && typeof obj[field] === "string") {
    return obj[field];
  }

  return "";
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .normalize("NFD") // separate accent from letter
    .replace(/[\u0300-\u036f]/g, "") // remove accent
    .replace(/\s+/g, "-") // replace spaces with -
    .replace(/[^\w-]+/g, "") // remove all non-word chars
    .replace(/--+/g, "-") // replace multiple - with single -
    .replace(/^-+/, "") // trim - from start of text
    .replace(/-+$/, ""); // trim - from end of text
}
