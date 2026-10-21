import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { locales } from "@/i18n/navigation";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://example.com";

// Rebuilt at most hourly; new/archived products show up within the hour.
export const revalidate = 3600;

const STATIC_PATHS = [
  "",
  "/shop",
  "/events",
  "/reviews",
  "/shipping-returns",
  "/terms",
  "/privacy",
  "/legal",
];

// One entry per page, listing every locale version as hreflang alternates.
function entry(path: string, lastModified?: string): MetadataRoute.Sitemap[number] {
  return {
    url: `${SITE_URL}/en${path}`,
    lastModified,
    alternates: {
      languages: Object.fromEntries([
        ...locales.map((l) => [l, `${SITE_URL}/${l}${path}`]),
        ["x-default", `${SITE_URL}/en${path}`],
      ]),
    },
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Plain anon client (no cookies) so the sitemap can be statically cached.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: products, error } = await supabase
    .from("products")
    .select("slug, updated_at")
    .eq("is_active", true)
    .eq("is_archived", false)
    .order("slug");
  if (error) throw error;

  return [
    ...STATIC_PATHS.map((p) => entry(p)),
    ...(products ?? []).map((p) => entry(`/shop/${p.slug}`, p.updated_at)),
  ];
}
