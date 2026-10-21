import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://example.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Private / per-visitor pages under every locale prefix.
      disallow: [
        "/api/",
        "/*/admin",
        "/*/account",
        "/*/auth/",
        "/*/cart",
        "/*/checkout",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
