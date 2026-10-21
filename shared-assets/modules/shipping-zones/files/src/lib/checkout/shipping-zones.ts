import type { ShippingZone } from "./pricing";

/**
 * Fetch all shipping zones (with their countries and weight brackets) shaped
 * for calculateShippingCost(). Pass an admin client — shipping_zones has no
 * public RLS policy, matching the cart_items pattern used elsewhere in checkout.
 */
export async function getShippingZonesForPricing(
  supabase: any,
): Promise<ShippingZone[]> {
  const [{ data: zones }, { data: countries }, { data: brackets }] =
    await Promise.all([
      supabase
        .from("shipping_zones")
        .select("id, name, is_default, free_shipping_threshold_cents")
        .order("sort_order", { ascending: true }),
      supabase.from("shipping_zone_countries").select("zone_id, country_code"),
      supabase
        .from("shipping_zone_brackets")
        .select("zone_id, max_weight_kg, price_cents")
        .order("sort_order", { ascending: true }),
    ]);

  return (zones ?? []).map((zone: any) => ({
    id: zone.id,
    name: zone.name,
    isDefault: zone.is_default,
    freeShippingThresholdCents: zone.free_shipping_threshold_cents,
    countryCodes: (countries ?? [])
      .filter((c: any) => c.zone_id === zone.id)
      .map((c: any) => c.country_code),
    brackets: (brackets ?? [])
      .filter((b: any) => b.zone_id === zone.id)
      .map((b: any) => ({
        maxWeightKg: b.max_weight_kg == null ? null : Number(b.max_weight_kg),
        priceCents: b.price_cents,
      })),
  }));
}
