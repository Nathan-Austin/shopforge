import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import ProductArchive from "@/components/store/ProductArchive";
import { getLocalizedField } from "@/lib/utils";
import type {
  StoreProduct,
  ChilliType,
  Category,
  StoreBrand,
} from "@/components/store/types";

export const revalidate = 300;

export default async function ShopPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "SauceArchive" });
  const supabase = await createClient();

  const isEn = locale === "en";
  const productSelect = `
    id, name, slug, description, ${isEn ? "" : `description_${locale},`} price_cents, currency,
    heat_level, image_url, in_stock, low_stock_quantity, is_active, is_vegan, is_sugar_free, on_sale, sale_price_cents,
    capacity_ml, weight_grams, display_unit, created_at,
    brand:brands ( id, name, slug, country, description ${isEn ? "" : `, description_${locale}`} ),
    category:categories!category_id ( id, name, slug ${isEn ? "" : `, name_${locale}`} ),
    chilliTypes:products_chilli_types (
      chilli_type:chilli_types ( id, name, slug, heat_level ${isEn ? "" : `, name_${locale}`} )
    ),
    variants:product_variants ( id, label, price_cents, sale_price_cents, weight_grams, in_stock, low_stock_quantity, sort_order )
  `;

  const [productsRes, categoriesRes, chilliTypesRes, brandsRes, ratingsRes, productCategoriesRes] =
    await Promise.all([
      supabase
        .from("products")
        .select(productSelect)
        .eq("is_active", true)
        .eq("is_archived", false)
        .order("created_at", { ascending: false }),

      supabase
        .from("categories")
        .select(`id, name, ${isEn ? "" : `name_${locale},`} slug`)
        .order("name"),

      supabase
        .from("chilli_types")
        .select(`id, name, ${isEn ? "" : `name_${locale},`} slug, heat_level`)
        .order("name"),

      supabase
        .from("brands")
        .select(
          `id, name, slug, country, description ${isEn ? "" : `, description_${locale}`}`,
        )
        .order("name"),

      supabase
        .from("product_ratings")
        .select("product_id, avg_rating, review_count"),

      supabase
        .from("product_categories")
        .select("product_id, category_id"),
    ]);

  // Log errors if they occur
  if (ratingsRes.error)
    console.error("Ratings fetch error:", ratingsRes.error);
  if (productsRes.error)
    console.error("Products fetch error:", productsRes.error);
  if (categoriesRes.error)
    console.error("Categories fetch error:", categoriesRes.error);
  if (chilliTypesRes.error)
    console.error("ChilliTypes fetch error:", chilliTypesRes.error);
  if (brandsRes.error) console.error("Brands fetch error:", brandsRes.error);

  const ratingsMap = new Map(
    (ratingsRes.data ?? []).map((r: any) => [r.product_id, r]),
  );

  // Build category lookup and per-product category lists from the flat junction query
  const categoriesRaw = (categoriesRes.data as any[] ?? []);
  const categoryById = new Map(
    categoriesRaw.map((c) => [
      String(c.id),
      { id: c.id, name: getLocalizedField(c, "name", locale), slug: c.slug } as Category,
    ]),
  );
  const productCategoryIds = new Map<string, string[]>();
  for (const pc of (productCategoriesRes.data ?? []) as any[]) {
    const list = productCategoryIds.get(pc.product_id) ?? [];
    list.push(String(pc.category_id));
    productCategoryIds.set(pc.product_id, list);
  }

  const products: StoreProduct[] = (productsRes.data ?? []).map((row) => {
    const r = row as any; // Temporary cast to bypass complex Supabase join types for now, but better than Record<string, any> in map
    const rating = ratingsMap.get(r.id);
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: getLocalizedField(r, "description", locale),
      price_cents: r.price_cents,
      currency: r.currency,
      heatLevel: r.heat_level,
      image_url: r.image_url,
      in_stock: r.in_stock,
      low_stock_quantity: r.low_stock_quantity,
      is_active: r.is_active,
      is_vegan: r.is_vegan,
      is_sugar_free: r.is_sugar_free,
      on_sale: r.on_sale,
      sale_price_cents: r.sale_price_cents,
      capacity_ml: r.capacity_ml,
      weight_grams: r.weight_grams,
      display_unit: r.display_unit,
      created_at: r.created_at,
      avgRating: rating ? Number(rating.avg_rating) : null,
      reviewCount: rating ? Number(rating.review_count) : 0,
      brand: r.brand
        ? {
            id: r.brand.id,
            name: r.brand.name,
            slug: r.brand.slug,
            country: r.brand.country,
            description: getLocalizedField(r.brand, "description", locale),
          }
        : null,
      category: r.category
        ? {
            id: r.category.id,
            name: getLocalizedField(r.category, "name", locale),
            slug: r.category.slug,
          }
        : null,
      categories: (productCategoryIds.get(String(r.id)) ?? [])
        .map((catId) => categoryById.get(catId))
        .filter(Boolean) as Category[],
      chilliTypes: (r.chilliTypes ?? [])
        .map((j: { chilli_type: any }) => j.chilli_type)
        .filter(Boolean)
        .map((ct: any) => ({
          id: ct.id,
          name: getLocalizedField(ct, "name", locale),
          slug: ct.slug,
          heatLevel: ct.heat_level,
        })),
      variants: (r.variants ?? [])
        .filter((v: any) => v.is_active !== false)
        .sort((a: any, b: any) => a.sort_order - b.sort_order || a.price_cents - b.price_cents)
        .map((v: any) => ({
          id: v.id,
          label: v.label,
          price_cents: v.price_cents,
          sale_price_cents: v.sale_price_cents,
          weight_grams: v.weight_grams,
          in_stock: v.in_stock,
          low_stock_quantity: v.low_stock_quantity,
          sort_order: v.sort_order,
        })),
    };
  });

  const categories: Category[] = Array.from(categoryById.values());

  const chilliTypes: ChilliType[] = (chilliTypesRes.data as any[] ?? []).map((ct) => ({
    id: ct.id,
    name: getLocalizedField(ct, "name", locale),
    slug: (ct as any).slug,
    heatLevel: (ct as any).heat_level,
  }));

  const brands: StoreBrand[] = (brandsRes.data as any[] ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    country: (b as any).country,
    description: getLocalizedField(b, "description", locale),
  }));

  return (
    <main>
      <div className="px-4 pt-8 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-foreground">{t("heading")}</h1>
        </div>
      </div>
      <ProductArchive
        products={products}
        categories={categories}
        chilliTypes={chilliTypes}
        brands={brands}
        locale={locale}
      />
    </main>
  );
}
