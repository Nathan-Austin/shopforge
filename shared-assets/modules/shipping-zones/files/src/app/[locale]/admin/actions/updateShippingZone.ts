"use server";

import { revalidatePath } from "next/cache";
import { ensureShopOwner } from "../lib/auth";

interface UpdateShippingZoneContext {
  locale: string;
  zoneId: string;
}

type BracketPayload = {
  id?: string;
  max_weight_kg: number | null;
  price_cents: number;
  sort_order: number;
};

function validateBrackets(brackets: BracketPayload[]): string | null {
  if (brackets.length === 0) return "Add at least one weight bracket.";
  if (brackets.some((b) => !Number.isFinite(b.price_cents) || b.price_cents < 0)) {
    return "Every bracket needs a price of €0 or more.";
  }
  const withBounds = brackets.filter((b) => b.max_weight_kg != null);
  const sorted = [...withBounds].sort((a, b) => a.max_weight_kg! - b.max_weight_kg!);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].max_weight_kg! <= sorted[i - 1].max_weight_kg!) {
      return "Weight brackets must have strictly increasing max weights.";
    }
  }
  const unboundedCount = brackets.length - withBounds.length;
  if (unboundedCount > 1) {
    return "Only one bracket can be left with no upper weight limit.";
  }
  return null;
}

export async function updateShippingZone(
  context: UpdateShippingZoneContext,
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) {
    return { error: "Not authorized" };
  }

  const zoneId = context.zoneId;

  const name = formData.get("name")?.toString().trim();
  if (!name) return { error: "Zone name is required." };

  const carrier = formData.get("carrier")?.toString().trim() || null;
  const isDefault = formData.get("is_default")?.toString() === "true";
  const thresholdRaw = formData.get("free_shipping_threshold")?.toString().trim();
  const freeShippingThresholdCents = thresholdRaw
    ? Math.round(parseFloat(thresholdRaw) * 100)
    : null;

  const countriesRaw = formData.get("countries")?.toString();
  const countries: string[] = countriesRaw ? JSON.parse(countriesRaw) : [];
  const countriesInitialCount = parseInt(
    formData.get("countries_initial_count")?.toString() ?? "-1",
    10,
  );
  if (!isDefault && new Set(countries).size !== countries.length) {
    return { error: "A country is listed more than once." };
  }

  const bracketsRaw = formData.get("brackets")?.toString();
  const brackets: BracketPayload[] = bracketsRaw ? JSON.parse(bracketsRaw) : [];
  const bracketError = validateBrackets(brackets);
  if (bracketError) return { error: bracketError };

  if (!isDefault) {
    // The UI locks this checkbox while the zone is default — changing the
    // default happens by checking it on a different zone instead, which
    // clears it here automatically (see the `else` branch below). This is
    // just a defensive guard against a stale/tampered request.
    const { data: currentZone } = await supabase
      .from("shipping_zones")
      .select("is_default")
      .eq("id", zoneId)
      .single();
    if (currentZone?.is_default) {
      return {
        error: "To change the default zone, set a different zone as default instead.",
      };
    }
  } else {
    await supabase
      .from("shipping_zones")
      .update({ is_default: false })
      .eq("is_default", true)
      .neq("id", zoneId);
  }

  const { error: zoneError } = await supabase
    .from("shipping_zones")
    .update({
      name,
      carrier,
      is_default: isDefault,
      free_shipping_threshold_cents: freeShippingThresholdCents,
    })
    .eq("id", zoneId);
  if (zoneError) return { error: zoneError.message };

  // Countries: diff by country_code (natural key) rather than surrogate id.
  if (isDefault) {
    await supabase.from("shipping_zone_countries").delete().eq("zone_id", zoneId);
  } else if (countries.length > 0) {
    await supabase
      .from("shipping_zone_countries")
      .delete()
      .eq("zone_id", zoneId)
      .not("country_code", "in", `(${countries.map((c) => `"${c}"`).join(",")})`);

    const { error: countryError } = await supabase
      .from("shipping_zone_countries")
      .upsert(
        countries.map((code) => ({ zone_id: zoneId, country_code: code })),
        { onConflict: "country_code" },
      );
    if (countryError) return { error: countryError.message };
  } else if (countriesInitialCount > 0) {
    // User saw N countries and removed them all intentionally.
    await supabase.from("shipping_zone_countries").delete().eq("zone_id", zoneId);
  }
  // If form loaded empty (countriesInitialCount <= 0) and submitted empty,
  // don't delete — protects against silent query failures wiping real data.

  // Brackets have no external references, so a full replace is simplest.
  await supabase.from("shipping_zone_brackets").delete().eq("zone_id", zoneId);
  const { error: bracketInsertError } = await supabase
    .from("shipping_zone_brackets")
    .insert(
      brackets.map((b) => ({
        zone_id: zoneId,
        max_weight_kg: b.max_weight_kg,
        price_cents: b.price_cents,
        sort_order: b.sort_order,
      })),
    );
  if (bracketInsertError) return { error: bracketInsertError.message };

  revalidatePath(`/${context.locale}/admin/shipping`);
  revalidatePath(`/${context.locale}/admin/shipping/${zoneId}`);

  return { success: "updated" };
}
