import { createNavigation } from "next-intl/navigation";

export const locales = [
  "nl",
  "en",
  "fr",
  "cs",
  "es",
  "de",
  "pl",
  "pt",
  "it",
  "da",
  "no",
  "sv",
  "uk",
  "ar",
  "bg",
] as const;

export const { Link, redirect, usePathname, useRouter } = createNavigation({
  locales,
});
