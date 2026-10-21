"use server";

import { revalidatePath } from "next/cache";
import { ensureShopOwner } from "../lib/auth";

interface CreateShippingZoneContext {
  locale: string;
}

type BracketPayload = {
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

export async function createShippingZone(
  context: CreateShippingZoneContext,
  formData: FormData,
): Promise<{ error?: string; success?: string; zoneId?: string }> {
  const { error, supabase } = await ensureShopOwner();
  if (error || !supabase) {
    return { error: "Not authorized" };
  }

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
  if (!isDefault && new Set(countries).size !== countries.length) {
    return { error: "A country is listed more than once." };
  }

  const bracketsRaw = formData.get("brackets")?.toString();
  const brackets: BracketPayload[] = bracketsRaw ? JSON.parse(bracketsRaw) : [];
  const bracketError = validateBrackets(brackets);
  if (bracketError) return { error: bracketError };

  if (isDefault) {
    await supabase.from("shipping_zones").update({ is_default: false }).eq("is_default", true);
  }

  const { data: zone, error: zoneError } = await supabase
    .from("shipping_zones")
    .insert({
      name,
      carrier,
      is_default: isDefault,
      free_shipping_threshold_cents: freeShippingThresholdCents,
    })
    .select("id")
    .single();

  if (zoneError || !zone) {
    return { error: zoneError?.message || "Failed to create zone." };
  }

  if (!isDefault && countries.length > 0) {
    const { error: countryError } = await supabase
      .from("shipping_zone_countries")
      .upsert(
        countries.map((code) => ({ zone_id: zone.id, country_code: code })),
        { onConflict: "country_code" },
      );
    if (countryError) return { error: countryError.message };
  }

  if (brackets.length > 0) {
    const { error: bracketInsertError } = await supabase
      .from("shipping_zone_brackets")
      .insert(
        brackets.map((b) => ({
          zone_id: zone.id,
          max_weight_kg: b.max_weight_kg,
          price_cents: b.price_cents,
          sort_order: b.sort_order,
        })),
      );
    if (bracketInsertError) return { error: bracketInsertError.message };
  }

  revalidatePath(`/${context.locale}/admin/shipping`);

  return { success: "created", zoneId: zone.id };
}
