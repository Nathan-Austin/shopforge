import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Category, ChilliType, StoreBrand } from "@/components/store/types";
import { requireShopOwner } from "../../lib/auth";
import ProductForm from "../../components/ProductForm";
import { updateProduct } from "../../actions/updateProduct";
import { deleteProduct } from "../../actions/deleteProduct";

interface ProductPageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditProductPage({ params }: ProductPageProps) {
  const { locale, id } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: "Admin" });

  const { data: productRow, error: productError } = await supabase
    .from("products")
    .select(
      `
      id,
      name,
      slug,
      price_cents,
      currency,
      description,
      details,
      pairing,
      image_url,
      heat_level,
      capacity_ml,
      weight_grams,
      display_unit,
      in_stock,
      low_stock_quantity,
      is_active,
      is_vegan,
      is_sugar_free,
      on_sale,
      sale_price_cents,
      ingredients,
      nutrition_info,
      category_id,
      brand_id,
      brand:brands ( id, name, slug ),
      category:categories!category_id ( id, name, slug ),
      products_chilli_types (
        chilli_type_id,
        chilli_types ( id, name, slug, heat_level )
      )
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (productError || !productRow) {
    notFound();
  }

  const [
    { data: categoriesData },
    { data: chilliTypesData },
    { data: brandsData },
    { data: variantsData },
    { data: productCategoriesData },
    { data: productImagesData },
  ] = await Promise.all([
    supabase.from("categories").select("id, name, slug").order("name"),
    supabase
      .from("chilli_types")
      .select("id, name, slug, heat_level")
      .order("name"),
    supabase.from("brands").select("id, name, slug").order("name"),
    supabase
      .from("product_variants")
      .select("id, label, price_cents, sale_price_cents, weight_grams, in_stock, low_stock_quantity, sort_order")
      .eq("product_id", id)
      .eq("is_active", true)
      .order("sort_order")
      .order("price_cents"),
    supabase
      .from("product_categories")
      .select("category_id")
      .eq("product_id", id),
    supabase
      .from("product_images")
      .select("url")
      .eq("product_id", id)
      .order("position"),
  ]);

  const categories: Category[] =
    categoriesData?.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
    })) ?? [];
  const chilliTypes: ChilliType[] =
    chilliTypesData?.map((ct) => ({
      id: ct.id,
      name: ct.name,
      slug: ct.slug,
      heatLevel: ct.heat_level,
    })) ?? [];
  const brands: StoreBrand[] =
    brandsData?.map((brand) => ({
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
    })) ?? [];

  const row = productRow as any;
  const product = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    price_cents: row.price_cents,
    currency: row.currency,
    description: row.description,
    details: row.details,
    pairing: row.pairing,
    image_url: row.image_url,
    heat_level: row.heat_level,
    heatLevel: row.heat_level,
    capacity_ml: row.capacity_ml,
    weight_grams: row.weight_grams,
    display_unit: row.display_unit,
    in_stock: row.in_stock,
    low_stock_quantity: row.low_stock_quantity,
    is_active: row.is_active,
    is_vegan: row.is_vegan,
    is_sugar_free: row.is_sugar_free,
    on_sale: row.on_sale,
    sale_price_cents: row.sale_price_cents,
    ingredients: row.ingredients,
    nutrition_info: row.nutrition_info,
    category_id: row.category_id,
    categoryIds: (() => {
      const fromJunction = (productCategoriesData ?? []).map((pc: any) => String(pc.category_id));
      return fromJunction.length > 0
        ? fromJunction
        : row.category_id
          ? [String(row.category_id)]
          : [];
    })(),
    imageUrls: (productImagesData ?? []).map((pi: any) => pi.url),
    brand_id: row.brand_id,
    brand: row.brand
      ? { id: row.brand.id, name: row.brand.name, slug: row.brand.slug || "" }
      : null,
    category: row.category
      ? { id: row.category.id, name: row.category.name, slug: row.category.slug || "" }
      : null,
    chilliTypes:
      row.products_chilli_types?.map((ct: any) => ({
        id: ct.chilli_type_id,
        name: ct.chilli_types?.name || "",
        slug: ct.chilli_types?.slug || "",
        heatLevel: ct.chilli_types?.heat_level,
      })) ?? [],
    variants: variantsData ?? [],
  };

  const defaultBrandId = brands[0]?.id;
  const updateAction = updateProduct.bind(null, { locale, defaultBrandId });
  const deleteAction = deleteProduct.bind(null, { locale });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          {t("products.editProduct")}
        </h2>
        <p className="text-sm text-text-muted">{product.name}</p>
      </div>

      <ProductForm
        product={product}
        categories={categories}
        chilliTypes={chilliTypes}
        brands={brands}
        onSubmit={updateAction}
        onDelete={deleteAction}
        successRedirectPath={`/${locale}/admin/products`}
      />
    </div>
  );
}
