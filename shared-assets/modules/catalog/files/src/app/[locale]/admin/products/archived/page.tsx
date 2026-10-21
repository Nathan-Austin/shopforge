import { Suspense } from "react";
import { requireShopOwner } from "../../lib/auth";
import ArchivedProductsClient from "./ArchivedProductsClient";

export const dynamic = "force-dynamic";

export default async function ArchivedProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);

  const { data: productsData } = await supabase
    .from("products")
    .select(
      `
      id,
      name,
      slug,
      price_cents,
      currency,
      heat_level,
      image_url,
      brand:brands ( id, name, slug ),
      category:categories!category_id ( id, name, slug )
    `,
    )
    .eq("is_archived", true)
    .order("name", { ascending: true });

  const products = (productsData ?? []).map((row: any) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    price_cents: row.price_cents as number,
    currency: row.currency as string,
    heatLevel: row.heat_level,
    image_url: row.image_url,
    brand: row.brand ? { id: row.brand.id, name: row.brand.name, slug: row.brand.slug || "" } : null,
    category: row.category ? { id: row.category.id, name: row.category.name, slug: row.category.slug || "" } : null,
  }));

  return (
    <Suspense>
      <ArchivedProductsClient products={products} locale={locale} />
    </Suspense>
  );
}
