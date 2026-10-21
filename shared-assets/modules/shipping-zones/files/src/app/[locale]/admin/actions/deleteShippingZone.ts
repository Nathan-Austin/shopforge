"use server";

import { revalidatePath } from "next/cache";
import { ensureShopOwner } from "../lib/auth";

interface DeleteShippingZoneContext {
  locale: string;
}

export async function deleteShippingZone(
  context: DeleteShippingZoneContext,
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) {
    return { error: "Not authorized" };
  }

  const zoneId = formData.get("zone_id")?.toString();
  if (!zoneId) return { error: "Missing zone ID" };

  const { data: zone } = await supabase
    .from("shipping_zones")
    .select("is_default")
    .eq("id", zoneId)
    .single();

  const { count: totalZones } = await supabase
    .from("shipping_zones")
    .select("id", { count: "exact", head: true });
  if ((totalZones ?? 0) <= 1) {
    return { error: "Can't delete the only shipping zone." };
  }

  if (zone?.is_default) {
    return {
      error: "This is the default zone — mark another zone as default before deleting it.",
    };
  }

  const { error: deleteError } = await supabase
    .from("shipping_zones")
    .delete()
    .eq("id", zoneId);
  if (deleteError) return { error: deleteError.message };

  revalidatePath(`/${context.locale}/admin/shipping`);

  return { success: "deleted" };
}
