"use server";

import { revalidatePath } from "next/cache";
import { ensureShopOwner } from "../lib/auth";

interface UpdateProductContext {
  locale: string;
  defaultBrandId?: string | number;
}

export async function updateProduct(
  context: UpdateProductContext,
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) {
    return { error: "Not authorized" };
  }

  const storeMode =
    process.env.NEXT_PUBLIC_STORE_MODE === "multi" ? "multi" : "single";
  const productId = formData.get("product_id")?.toString();
  if (!productId) {
    return { error: "Missing product ID" };
  }

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

  const variantsInitialCount = parseInt(
    formData.get("variants_initial_count")?.toString() ?? "-1",
    10,
  );

  const chilliTypeIds = formData
    .getAll("chilliTypeIds")
    .map((id) => id.toString())
    .filter(Boolean);

  if (!name || !slug || Number.isNaN(priceCents)) {
    return { error: "Missing required fields" };
  }

  // Ensure unique slug (excluding current product)
  let uniqueSlug = slug;
  let counter = 1;
  while (true) {
    const { data: existing } = await supabase
      .from("products")
      .select("id")
      .eq("slug", uniqueSlug)
      .neq("id", productId)
      .maybeSingle();

    if (!existing) break;
    uniqueSlug = `${slug}-${counter}`;
    counter++;
  }
  slug = uniqueSlug;

  if (storeMode === "multi" && !brandId) {
    return { error: "Brand is required in multi-store mode" };
  }

  const { error: updateError } = await supabase
    .from("products")
    .update({
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
    .eq("id", productId);

  if (updateError) {
    return { error: updateError.message };
  }

  // Replace product images
  await supabase.from("product_images").delete().eq("product_id", productId);
  if (imageUrls.length > 0) {
    await supabase.from("product_images").insert(
      imageUrls.map((url, position) => ({ product_id: productId, url, position })),
    );
  }

  await supabase
    .from("products_chilli_types")
    .delete()
    .eq("product_id", productId);

  if (chilliTypeIds.length > 0) {
    const rows = chilliTypeIds.map((chilliId) => ({
      product_id: productId,
      chilli_type_id: chilliId,
    }));
    const { error: insertError } = await supabase
      .from("products_chilli_types")
      .insert(rows);
    if (insertError) {
      return { error: insertError.message };
    }
  }

  await supabase
    .from("product_categories")
    .delete()
    .eq("product_id", productId);

  if (categoryIds.length > 0) {
    const catRows = categoryIds.map((catId) => ({
      product_id: productId,
      category_id: catId,
    }));
    const { error: catInsertError } = await supabase
      .from("product_categories")
      .insert(catRows);
    if (catInsertError) {
      return { error: catInsertError.message };
    }
  }

  // Save variants: upsert existing, insert new, delete removed
  const variantsRaw = formData.get("variants")?.toString();
  if (variantsRaw) {
    type VariantPayload = {
      id?: string;
      label: string;
      price_cents: number;
      sale_price_cents: number | null;
      weight_grams: number | null;
      in_stock: boolean;
      low_stock_quantity: number | null;
      sort_order: number;
    };
    const incoming = JSON.parse(variantsRaw) as VariantPayload[];
    const keptIds = incoming
      .map((v) => v.id)
      .filter((id): id is string => Boolean(id));

    if (keptIds.length > 0) {
      // Delete only variants the user explicitly removed (not in kept list)
      await supabase
        .from("product_variants")
        .delete()
        .eq("product_id", productId)
        .not("id", "in", `(${keptIds.join(",")})`);
    } else if (incoming.length === 0 && variantsInitialCount > 0) {
      // User saw N variants and removed them all intentionally
      await supabase.from("product_variants").delete().eq("product_id", productId);
    }
    // If form loaded empty (variantsInitialCount <= 0) and incoming is empty,
    // don't delete — protects against silent query failures wiping real data.

    if (incoming.length > 0) {
      const { error: variantError } = await supabase
        .from("product_variants")
        .upsert(
          incoming.map((v, i) => ({
            ...(v.id ? { id: v.id } : {}),
            product_id: productId,
            label: v.label,
            price_cents: v.price_cents,
            sale_price_cents: v.sale_price_cents,
            weight_grams: v.weight_grams,
            in_stock: v.in_stock,
            low_stock_quantity: v.low_stock_quantity,
            sort_order: i,
          })),
        );
      if (variantError) {
        return { error: variantError.message };
      }
    }
  }

  revalidatePath(`/${context.locale}/admin/products`);
  revalidatePath(`/${context.locale}/admin/products/${productId}`);
  revalidatePath("/", "layout"); // bust ISR cache for shop pages across all locales

  return { success: "updated" };
}
