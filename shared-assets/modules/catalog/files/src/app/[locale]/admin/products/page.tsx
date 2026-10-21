import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import type { StoreProduct } from "@/components/store/types";
import { requireShopOwner } from "../lib/auth";
import ProductsClient from "./ProductsClient";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: "Admin" });

  const [{ data: productsData }, { data: categoriesData }] = await Promise.all([
    supabase
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
        on_sale,
        sale_price_cents,
        in_stock,
        low_stock_quantity,
        low_stock_threshold,
        brand:brands ( id, name, slug ),
        category:categories!category_id ( id, name, slug )
      `,
      )
      .eq("is_archived", false)
      .order("name", { ascending: true }),
    supabase
      .from("categories")
      .select("id, name, slug")
      .order("name", { ascending: true }),
  ]);

  const products: StoreProduct[] =
    productsData?.map((row: any) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      price_cents: row.price_cents,
      currency: row.currency,
      heatLevel: row.heat_level,
      image_url: row.image_url,
      on_sale: row.on_sale,
      sale_price_cents: row.sale_price_cents,
      in_stock: row.in_stock,
      low_stock_quantity: row.low_stock_quantity,
      low_stock_threshold: row.low_stock_threshold,
      brand: row.brand
        ? { id: row.brand.id, name: row.brand.name, slug: row.brand.slug || "" }
        : null,
      category: row.category
        ? { id: row.category.id, name: row.category.name, slug: row.category.slug || "" }
        : null,
    })) ?? [];

  const categories = (categoriesData ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
  }));

  return (
    <Suspense>
      <ProductsClient
        products={products}
        categories={categories}
        locale={locale}
        labels={{
          heading: t("products.heading"),
          subheading: t("products.subheading"),
          newProduct: t("products.newProduct"),
          name: t("products.name"),
          category: t("products.category"),
          brand: t("products.brand"),
          heat: t("products.heat"),
          price: t("products.price"),
          actions: t("products.actions"),
          edit: t("products.edit"),
          notSet: t("form.notSet"),
          empty: t("products.empty"),
        }}
      />
    </Suspense>
  );
}
