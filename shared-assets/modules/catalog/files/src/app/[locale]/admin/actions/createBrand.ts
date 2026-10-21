"use server";

import { revalidatePath } from "next/cache";
import { ensureShopOwner } from "../lib/auth";

interface CreateBrandContext {
  locale: string;
}

export async function createBrand(
  context: CreateBrandContext,
  formData: FormData,
): Promise<{ error?: string; success?: string; brandId?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) {
    return { error: "Not authorized" };
  }

  const name = formData.get("name")?.toString().trim();
  let slug = formData.get("slug")?.toString().trim();
  const description = formData.get("description")?.toString().trim() || null;
  const country = formData.get("country")?.toString().trim() || null;
  const website = formData.get("website")?.toString().trim() || null;

  if (!name || !slug) {
    return { error: "Missing required fields" };
  }

  // Ensure unique slug
  let uniqueSlug = slug;
  let counter = 1;
  while (true) {
    const { data: existing } = await supabase
      .from("brands")
      .select("id")
      .eq("slug", uniqueSlug)
      .maybeSingle();

    if (!existing) break;
    uniqueSlug = `${slug}-${counter}`;
    counter++;
  }
  slug = uniqueSlug;

  const { data: brand, error: insertError } = await supabase
    .from("brands")
    .insert({
      name,
      slug,
      description,
      country,
      website,
    })
    .select("id")
    .single();

  if (insertError || !brand) {
    return { error: insertError?.message || "Unable to create brand" };
  }

  revalidatePath(`/${context.locale}/admin/brands`);
  revalidatePath(`/${context.locale}/admin/products`);

  return { success: "created", brandId: brand.id };
}
