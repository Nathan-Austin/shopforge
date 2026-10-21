import { getTranslations } from "next-intl/server";
import { requireShopOwner } from "../lib/auth";
import EventsClient from "./EventsClient";

export const dynamic = "force-dynamic";

export default async function AdminEventsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: "Admin" });

  const { data: events } = await supabase
    .from("shop_events")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          Events Management
        </h2>
        <p className="text-sm text-zinc-500">
          Add or remove upcoming events and markets.
        </p>
      </div>

      <EventsClient events={events || []} />
    </div>
  );
}
