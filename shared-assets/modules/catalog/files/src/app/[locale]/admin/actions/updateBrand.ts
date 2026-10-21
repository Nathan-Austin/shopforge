"use server";

import { revalidatePath } from "next/cache";
import { ensureShopOwner } from "../lib/auth";

interface UpdateBrandContext {
  locale: string;
  brandId: string;
}

export async function updateBrand(
  context: UpdateBrandContext,
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) {
    return { error: "Not authorized" };
  }

  const name = formData.get("name")?.toString().trim();
  const description = formData.get("description")?.toString().trim() || null;
  const country = formData.get("country")?.toString().trim() || null;
  const website = formData.get("website")?.toString().trim() || null;

  if (!name) {
    return { error: "Brand name is required" };
  }

  const { error: updateError } = await supabase
    .from("brands")
    .update({
      name,
      description,
      country,
      website,
    })
    .eq("id", context.brandId);

  if (updateError) {
    return { error: updateError.message || "Unable to update brand" };
  }

  revalidatePath(`/${context.locale}/admin/brands`);
  revalidatePath(`/${context.locale}/admin/products`);

  return { success: "updated" };
}
