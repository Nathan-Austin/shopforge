import { notFound } from "next/navigation";
import { requireShopOwner } from "../../lib/auth";
import ShippingZoneForm from "../../components/ShippingZoneForm";
import { updateShippingZone } from "../../actions/updateShippingZone";
import { deleteShippingZone } from "../../actions/deleteShippingZone";

interface ShippingZonePageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditShippingZonePage({ params }: ShippingZonePageProps) {
  const { locale, id } = await params;
  const { supabase } = await requireShopOwner(locale);

  const { data: zone, error } = await supabase
    .from("shipping_zones")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !zone) notFound();

  const [{ data: countryRows }, { data: bracketRows }] = await Promise.all([
    supabase
      .from("shipping_zone_countries")
      .select("country_code")
      .eq("zone_id", id),
    supabase
      .from("shipping_zone_brackets")
      .select("id, max_weight_kg, price_cents")
      .eq("zone_id", id)
      .order("sort_order", { ascending: true }),
  ]);

  const updateAction = updateShippingZone.bind(null, { locale, zoneId: id });
  const deleteAction = deleteShippingZone.bind(null, { locale });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Edit shipping zone</h2>
        <p className="text-sm text-text-muted">{zone.name}</p>
      </div>

      <ShippingZoneForm
        zone={zone}
        initialCountries={(countryRows ?? []).map((c) => c.country_code)}
        initialBrackets={bracketRows ?? []}
        onSubmit={updateAction}
        onDelete={deleteAction}
        successRedirectPath={`/${locale}/admin/shipping`}
      />
    </div>
  );
}
