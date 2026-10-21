"use server";

import { revalidatePath } from "next/cache";
import { ensureShopOwner } from "../lib/auth";

interface CreateProductContext {
  locale: string;
  defaultBrandId?: string | number;
}

export async function createProduct(
  context: CreateProductContext,
  formData: FormData,
): Promise<{ error?: string; success?: string; productId?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) {
    return { error: "Not authorized" };
  }

  const storeMode =
    process.env.NEXT_PUBLIC_STORE_MODE === "multi" ? "multi" : "single";
  const name = formData.get("name")?.toString().trim();
  let slug = formData.get("slug")?.toString().trim();
  const priceCents = Number(formData.get("price_cents"));
  const currency = formData.get("currency")?.toString() || "GBP";
  const description = formData.get("description")?.toString() || "";
  const details = formData.get("details")?.toString() || null;
  const pairing = formData.get("pairing")?.toString() || null;
  const heatLevel = formData.get("heat_level")?.toString() || null;
  const categoryIds = formData
    .getAll("categoryIds")
    .map((id) => id.toString())
    .filter(Boolean);
  const categoryId = categoryIds[0] || null;
  const brandId =
    formData.get("brand_id")?.toString() ||
    (context.defaultBrandId ? String(context.defaultBrandId) : null);
  const imageUrls = formData
    .getAll("imageUrls")
    .map((u) => u.toString())
    .filter(Boolean);
  const imageUrl = imageUrls[0] || null;
  const ingredients = formData.get("ingredients")?.toString() || null;
  const capacityMl = formData.get("capacity_ml")
    ? Number(formData.get("capacity_ml"))
    : null;
  const weightGrams = formData.get("weight_grams")
    ? Number(formData.get("weight_grams"))
    : null;
  const inStock = formData.get("in_stock") === "on";
  const lowStockRaw = formData.get("low_stock_quantity")?.toString().trim();
  const lowStockQuantity = lowStockRaw ? Number(lowStockRaw) : null;
  const isActive = formData.get("is_active") === "true";
  const isVegan = formData.get("is_vegan") === "on";
  const isSugarFree = formData.get("is_sugar_free") === "on";
  const onSale = formData.get("on_sale") === "on";
  const salePriceRaw = formData.get("sale_price_cents")?.toString().trim();
  const salePriceCents = salePriceRaw ? Number(salePriceRaw) : null;
  const displayUnit = formData.get("display_unit")?.toString() || "ml";
  const nutritionInfoRaw = formData.get("nutrition_info")?.toString();
  const nutritionInfo = nutritionInfoRaw ? JSON.parse(nutritionInfoRaw) : null;

  const sizeOptionsRaw = formData.get("size_options")?.toString() || "";
  const colorOptionsRaw = formData.get("color_options")?.toString() || "";
  const sizeOptions = sizeOptionsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const colorOptions = colorOptionsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const chilliTypeIds = formData
    .getAll("chilliTypeIds")
    .map((id) => id.toString())
    .filter(Boolean);

  if (!name || !slug || Number.isNaN(priceCents)) {
    return { error: "Missing required fields" };
  }

  // Ensure unique slug
  let uniqueSlug = slug;
  let counter = 1;
  while (true) {
    const { data: existing } = await supabase
      .from("products")
      .select("id")
      .eq("slug", uniqueSlug)
      .maybeSingle();

    if (!existing) break;
    uniqueSlug = `${slug}-${counter}`;
    counter++;
  }
  slug = uniqueSlug;

  if (storeMode === "multi" && !brandId) {
    return { error: "Brand is required in multi-store mode" };
  }

  const { data: product, error: insertError } = await supabase
    .from("products")
    .insert({
      name,
      slug,
      price_cents: priceCents,
      currency,
      description,
      details,
      pairing,
      image_url: imageUrl,
      heat_level: heatLevel,
      category_id: categoryId,
      brand_id: brandId,
      ingredients,
      capacity_ml: capacityMl,
      weight_grams: weightGrams,
      display_unit: displayUnit,
      in_stock: inStock,
      low_stock_quantity: lowStockQuantity,
      is_active: isActive,
      is_vegan: isVegan,
      is_sugar_free: isSugarFree,
      on_sale: onSale,
      sale_price_cents: salePriceCents,
      nutrition_info: nutritionInfo,
      size_options: sizeOptions.length > 0 ? sizeOptions : null,
      color_options: colorOptions.length > 0 ? colorOptions : null,
    })
    .select("id")
    .single();

  if (insertError || !product) {
    return { error: insertError?.message || "Unable to create product" };
  }

  if (imageUrls.length > 0) {
    await supabase.from("product_images").insert(
      imageUrls.map((url, position) => ({ product_id: product.id, url, position })),
    );
  }

  if (chilliTypeIds.length > 0) {
    const joinRows = chilliTypeIds.map((chilliId) => ({
      product_id: product.id,
      chilli_type_id: chilliId,
    }));
    const { error: joinError } = await supabase
      .from("products_chilli_types")
      .insert(joinRows);
    if (joinError) {
      return { error: joinError.message };
    }
  }

  if (categoryIds.length > 0) {
    const catRows = categoryIds.map((catId) => ({
      product_id: product.id,
      category_id: catId,
    }));
    const { error: catError } = await supabase
      .from("product_categories")
      .insert(catRows);
    if (catError) {
      return { error: catError.message };
    }
  }

  // Save variants
  const variantsRaw = formData.get("variants")?.toString();
  if (variantsRaw) {
    const variantRows = JSON.parse(variantsRaw) as Array<{
      label: string;
      price_cents: number;
      sale_price_cents: number | null;
      weight_grams: number | null;
      in_stock: boolean;
      low_stock_quantity: number | null;
      sort_order: number;
    }>;
    if (variantRows.length > 0) {
      await supabase
        .from("product_variants")
        .insert(variantRows.map((v) => ({ ...v, product_id: product.id })));
    }
  }

  revalidatePath(`/${context.locale}/admin/products`);
  revalidatePath("/", "layout");

  return { success: "created", productId: product.id };
}
