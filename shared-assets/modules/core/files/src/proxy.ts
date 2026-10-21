import createMiddleware from "next-intl/middleware";

export default createMiddleware({
  locales: [
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
  ],
  defaultLocale: "en",
  localePrefix: "always",
  localeDetection: true, // This will detect browser lang, but defaultLocale is 'en'
});

export const config = {
  matcher: ["/((?!_next|api|auth/callback|.*\\..*).*)"],
};
