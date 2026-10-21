import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getShippingZonesForPricing } from "@/lib/checkout/shipping-zones";
import { buildProductSchema, serializeSchema } from "@/lib/store/product-schema";
import { formatPrice, formatVolume } from "@/lib/format";
import { getEffectivePriceCents, getRegularPriceCents, isOnSale } from "@/lib/pricing";
import { Star, Vegan, CandyOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import AddToCartButton from "@/components/store/AddToCartButton";
import ProductVariantSelector from "@/components/store/ProductVariantSelector";
import ProductReviews from "@/components/store/ProductReviews";
import { ProductImageCarousel } from "@/components/store/ProductImageCarousel";
import { SimpleMarkdown } from "@/components/ui/simple-markdown";
import { getLocalizedField } from "@/lib/utils";

export const revalidate = 300;

// "Only N left in stock" only shows once the tracked quantity drops to this
// many or fewer — above it, a low_stock_quantity carried over from the old
// stock count (which may just be a large, meaningless number) stays silent.
const LOW_STOCK_DISPLAY_THRESHOLD = 5;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const supabase = await createClient();
  const isEn = locale === "en";
  const { data: row } = await supabase
    .from("products")
    .select(`name, description ${isEn ? "" : `, description_${locale}`}`)
    .eq("slug", slug)
    .eq("is_active", true)
    .eq("is_archived", false)
    .maybeSingle();

  if (!row) return {};
  const product = row as Record<string, any>;
  return {
    title: product.name,
    description:
      getLocalizedField(product, "description", locale).slice(0, 160) ??
      undefined,
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: "ProductPage" });
  const supabase = await createClient();

  const isEn = locale === "en";
  const productSelect = `
    id, name, slug, description, ${isEn ? "" : `description_${locale},`} details, ${isEn ? "" : `details_${locale},`}
    price_cents, currency, heat_level,
    image_url, capacity_ml, weight_grams, display_unit, ingredients, ${isEn ? "" : `ingredients_${locale},`}
    pairing, ${isEn ? "" : `pairing_${locale},`}
    in_stock, low_stock_quantity, is_active, is_vegan, is_sugar_free, on_sale, sale_price_cents,
    brand:brands ( id, name, slug ),
    category:categories!category_id ( id, name, slug ${isEn ? "" : `, name_${locale}`} ),
    allCategories:product_categories (
      category:categories ( id, name, slug ${isEn ? "" : `, name_${locale}`} )
    ),
    chilliTypes:products_chilli_types (
      chilli_type:chilli_types ( id, name, slug, heat_level ${isEn ? "" : `, name_${locale}`} )
    )
  `;

  const { data: row, error } = await supabase
    .from("products")
    .select(productSelect)
    .eq("slug", slug)
    .eq("is_active", true)
    .eq("is_archived", false)
    .maybeSingle();

  if (error) console.error("Product fetch error:", error);
  if (!row) notFound();

  const productId = (row as any).id;

  const [{ data: variantsData }, { data: ratingRow }, { data: productImagesData }, zones] =
    await Promise.all([
      supabase
        .from("product_variants")
        .select("id, label, price_cents, sale_price_cents, weight_grams, in_stock, low_stock_quantity, sort_order")
        .eq("product_id", productId)
        .eq("is_active", true)
        .order("sort_order")
        .order("price_cents"),
      supabase
        .from("product_ratings")
        .select("avg_rating, review_count")
        .eq("product_id", productId)
        .maybeSingle(),
      supabase
        .from("product_images")
        .select("url")
        .eq("product_id", productId)
        .order("position"),
      // shipping_zones has no public RLS policy; same server-only admin read
      // as checkout/page.tsx, used for the JSON-LD shipping rates below.
      getShippingZonesForPricing(createAdminClient()),
    ]);

  const avgRating = ratingRow ? Number((ratingRow as any).avg_rating) : null;
  const reviewCount = ratingRow ? Number((ratingRow as any).review_count) : 0;

  const rawProduct = row as Record<string, any>;
  const carouselImages: string[] =
    productImagesData && productImagesData.length > 0
      ? (productImagesData as any[]).map((r) => r.url)
      : rawProduct.image_url
        ? [rawProduct.image_url]
        : [];
  const brand = rawProduct.brand as {
    id: string;
    name: string;
    slug: string;
  } | null;
  const category = rawProduct.category
    ? {
        id: rawProduct.category.id,
        name: getLocalizedField(
          rawProduct.category as Record<string, any>,
          "name",
          locale,
        ),
        slug: rawProduct.category.slug,
      }
    : null;

  const allCategories: { id: string; name: string; slug: string }[] = (
    (rawProduct.allCategories ?? []) as Array<{ category: Record<string, any> }>
  )
    .map((j) => j.category)
    .filter(Boolean)
    .map((cat) => ({
      id: cat.id,
      name: getLocalizedField(cat, "name", locale),
      slug: cat.slug,
    }));
  const chilliTypes: {
    id: string;
    name: string;
    slug: string;
    heat_level: string | null;
  }[] = (rawProduct.chilliTypes ?? [])
    .map((j: any) => j.chilli_type)
    .filter(Boolean)
    .map((ct: any) => ({
      id: ct.id,
      name: getLocalizedField(ct as Record<string, any>, "name", locale),
      slug: ct.slug,
      heat_level: ct.heat_level,
    }));

  const product: any = {
    ...rawProduct,
    description: getLocalizedField(rawProduct, "description", locale),
    ingredients: getLocalizedField(rawProduct, "ingredients", locale),
    pairing: getLocalizedField(rawProduct, "pairing", locale),
    details: getLocalizedField(rawProduct, "details", locale),
  };

  const inStock = product.in_stock ?? true;
  const rawLowStockQuantity: number | null = product.low_stock_quantity ?? null;
  const lowStockQuantity =
    rawLowStockQuantity != null && rawLowStockQuantity <= LOW_STOCK_DISPLAY_THRESHOLD
      ? rawLowStockQuantity
      : null;

  const schema = buildProductSchema({
    locale,
    product,
    variants: variantsData ?? [],
    images: carouselImages,
    avgRating,
    reviewCount,
    zones,
  });

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeSchema(schema) }}
      />
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-text-muted flex flex-wrap items-center gap-2">
        <Link
          href={`/${locale}/shop`}
          className="hover:text-foreground transition-colors"
        >
          {t("breadcrumbShop")}
        </Link>
        <span>/</span>
        {category && (
          <>
            <span>{category.name}</span>
            <span>/</span>
          </>
        )}
        <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
        {/* Image */}
        <ProductImageCarousel images={carouselImages} alt={product.name} />

        {/* Details */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {product.on_sale && (
              <Badge className="gap-1 bg-brand-red hover:bg-brand-red text-white">
                {t("sale")}
              </Badge>
            )}
            {(allCategories.length > 0 ? allCategories : category ? [category] : []).map((cat) => (
              <Badge key={cat.id} variant="secondary">{cat.name}</Badge>
            ))}
            {product.heat_level && (
              <Badge
                variant="outline"
                className="text-orange-600 border-orange-300"
              >
                {t("heatLevel")} {product.heat_level}
              </Badge>
            )}
            {product.is_vegan && (
              <Badge className="gap-1 bg-green-600 hover:bg-green-600 text-white">
                <Vegan size={13} />
                {t("vegan")}
              </Badge>
            )}
            {product.is_sugar_free && (
              <Badge className="gap-1 bg-orange-600 hover:bg-orange-600 text-white">
                <CandyOff size={13} />
                {t("sugarFree")}
              </Badge>
            )}
          </div>

          <h1 className="text-2xl font-bold text-foreground leading-snug">
            {product.name}
          </h1>

          {brand && (
            <p className="text-sm text-text-muted">
              {t("by")}{" "}
              <span className="font-semibold text-foreground">
                {brand.name}
              </span>
            </p>
          )}

          {reviewCount > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex text-orange-400">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    size={16}
                    fill={i < Math.round(avgRating ?? 0) ? "currentColor" : "none"}
                    className={i < Math.round(avgRating ?? 0) ? "" : "text-zinc-200"}
                  />
                ))}
              </div>
              <span className="text-sm text-zinc-500">
                {avgRating?.toFixed(1)} ({reviewCount} {reviewCount === 1 ? t("reviewCount") : t("reviewsCount")})
              </span>
            </div>
          )}

          {formatVolume(product) && (
            <p className="text-sm text-text-muted">{formatVolume(product)}</p>
          )}

          {variantsData && variantsData.length > 0 ? (
            <ProductVariantSelector
              productId={product.id}
              variants={variantsData}
              basePriceCents={product.price_cents}
              onSale={product.on_sale}
              saleBasePriceCents={product.sale_price_cents}
              currency={product.currency}
              outOfStock={!inStock}
            />
          ) : (
            <>
              <div className="flex items-center gap-3">
                {isOnSale(product) && (
                  <span className="text-lg text-zinc-500 line-through">
                    {formatPrice(getRegularPriceCents(product), product.currency, locale)}
                  </span>
                )}
                <p className={`text-3xl font-bold ${isOnSale(product) ? "text-brand-red" : "text-foreground"}`}>
                  {formatPrice(getEffectivePriceCents(product), product.currency, locale)}
                </p>
              </div>

              {/* Stock */}
              <p
                className={`text-sm font-medium ${inStock ? "text-green-600" : "text-red-500"}`}
              >
                {inStock
                  ? lowStockQuantity != null
                    ? t("lowStock", { count: lowStockQuantity })
                    : t("inStock")
                  : t("outOfStock")}
              </p>

              <AddToCartButton
                productId={product.id}
                outOfStock={!inStock}
                label={t("addToCart")}
                outOfStockLabel={t("outOfStock")}
                size="lg"
                className="w-full sm:w-auto bg-brand-red hover:bg-brand-red/90 text-white"
              />
            </>
          )}

          {/* Chilli types */}
          {chilliTypes.length > 0 && (
            <div className="mt-2 border-t border-border pt-4">
              <h2 className="text-sm font-semibold text-foreground mb-2">
                {t("peppers")}
              </h2>
              <div className="flex flex-wrap gap-2">
                {chilliTypes.map((ct) => (
                  <Badge key={ct.id} variant="outline">
                    {ct.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Ingredients */}
          {product.ingredients && (
            <div className="border-t border-border pt-4">
              <h2 className="text-sm font-semibold text-foreground mb-2">
                {t("ingredients")}
              </h2>
              <p className="text-sm text-text-muted">
                <SimpleMarkdown>{product.ingredients}</SimpleMarkdown>
              </p>
            </div>
          )}

          {/* Description */}
          {product.description && (
            <div className="border-t border-border pt-4">
              <h2 className="text-sm font-semibold text-foreground mb-2">
                {t("description")}
              </h2>
              <p className="text-sm text-text-muted leading-relaxed whitespace-pre-line">
                <SimpleMarkdown>{product.description}</SimpleMarkdown>
              </p>
            </div>
          )}

          {/* Pairing */}
          {product.pairing && (
            <div className="border-t border-border pt-4">
              <h2 className="text-sm font-semibold text-foreground mb-2">
                {t("pairing")}
              </h2>
              <p className="text-sm text-text-muted leading-relaxed whitespace-pre-line">
                <SimpleMarkdown>{product.pairing}</SimpleMarkdown>
              </p>
            </div>
          )}
        </div>
      </div>

      <ProductReviews productId={product.id} locale={locale} />
    </main>
  );
}
