import { getRequestConfig } from "next-intl/server";

const locales = [
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
];

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !locales.includes(locale)) {
    locale = "en";
  }
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
