import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Truck, Plus } from "lucide-react";
import { formatPrice } from "@/lib/format";

export default async function ShippingZonesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();

  const [{ data: zones }, { data: countries }, { data: brackets }] =
    await Promise.all([
      supabase
        .from("shipping_zones")
        .select("*")
        .order("sort_order", { ascending: true }),
      supabase.from("shipping_zone_countries").select("zone_id, country_code"),
      supabase
        .from("shipping_zone_brackets")
        .select("zone_id, price_cents")
        .order("sort_order", { ascending: true }),
    ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shipping Zones</h1>
          <p className="text-sm text-zinc-500">
            Manage shipping carriers, countries, and weight-based rates.
          </p>
        </div>
        <Button asChild className="bg-black text-white hover:bg-zinc-800">
          <Link href={`/${locale}/admin/shipping/new`}>
            <Plus className="mr-2 h-4 w-4" />
            New Zone
          </Link>
        </Button>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-zinc-50 border-b">
              <th className="px-6 py-4 font-bold">Zone</th>
              <th className="px-6 py-4 font-bold">Carrier</th>
              <th className="px-6 py-4 font-bold">Countries</th>
              <th className="px-6 py-4 font-bold">Price range</th>
              <th className="px-6 py-4 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {!zones || zones.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-zinc-500">
                  <Truck className="mx-auto h-12 w-12 text-zinc-200 mb-4" />
                  <p>No shipping zones yet. Create your first one.</p>
                </td>
              </tr>
            ) : (
              zones.map((zone) => {
                const zoneCountries =
                  countries?.filter((c) => c.zone_id === zone.id) ?? [];
                const zoneBrackets =
                  brackets?.filter((b) => b.zone_id === zone.id) ?? [];
                const prices = zoneBrackets.map((b) => b.price_cents);
                const min = prices.length ? Math.min(...prices) : null;
                const max = prices.length ? Math.max(...prices) : null;

                return (
                  <tr key={zone.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-zinc-900">{zone.name}</div>
                      {zone.is_default && (
                        <span className="text-[10px] uppercase font-bold text-blue-600">
                          Default (fallback)
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">{zone.carrier || "—"}</td>
                    <td className="px-6 py-4">
                      {zone.is_default
                        ? "Everywhere not listed elsewhere"
                        : `${zoneCountries.length} ${zoneCountries.length === 1 ? "country" : "countries"}`}
                    </td>
                    <td className="px-6 py-4">
                      {min != null && max != null
                        ? min === max
                          ? formatPrice(min)
                          : `${formatPrice(min)} – ${formatPrice(max)}`
                        : "No brackets set"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/${locale}/admin/shipping/${zone.id}`}>Edit</Link>
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
