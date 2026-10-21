import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { getLocalizedField } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Events" });
  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

export default async function EventsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Events" });
  const supabase = await createClient();

  const { data: events } = await supabase
    .from("shop_events")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  return (
    <main className="max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
      {/* Hero Section */}
      <div className="flex flex-col lg:flex-row items-center gap-12 mb-20 bg-zinc-50 rounded-3xl p-8 lg:p-12 border border-zinc-100">
        <div className="flex-1 text-left">
          <h1 className="text-4xl font-extrabold text-foreground sm:text-5xl tracking-tight mb-6">
            {t("title")}
          </h1>
          <p className="text-xl text-text-muted leading-relaxed mb-8 whitespace-pre-line">
            {t("intro")}
          </p>
          <div className="flex flex-wrap gap-4">
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-brand-red/10 text-brand-red text-sm font-bold">
              🌶️ Meet the Maker
            </span>
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-orange-100 text-orange-700 text-sm font-bold">
              🔥 Free Tastings
            </span>
          </div>
        </div>
        <div className="relative w-full lg:w-96 aspect-square rounded-2xl overflow-hidden shadow-2xl rotate-2">
          <Image
            src="/images/maker.jpg"
            alt="Meet the Maker"
            fill
            className="object-cover"
            priority
          />
        </div>
      </div>

      {/* Grid of Locations */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {(events ?? []).map((event) => {
          const name = getLocalizedField(event, "name", locale);
          const dateInfo = getLocalizedField(event, "date_info", locale);
          
          return (
            <div
              key={event.id}
              className="group p-6 bg-white border border-border rounded-2xl hover:border-brand-red hover:shadow-xl transition-all duration-300 flex flex-col h-full"
            >
              <div className="text-3xl mb-4 group-hover:scale-110 transition-transform duration-300">
                📍
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">
                {name}
              </h3>
              <p className="text-sm text-text-muted mb-4">{event.location}</p>
              {dateInfo && (
                <p className="text-sm font-semibold text-brand-red mt-auto">
                  {dateInfo}
                </p>
              )}
              {event.website_url && (
                <a 
                  href={event.website_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="mt-4 text-xs text-zinc-400 hover:text-brand-red transition-colors"
                >
                  Visit Website →
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* Markets Note */}
      <div className="mt-16 text-center p-12 rounded-3xl border-2 border-dashed border-zinc-200">
        <p className="text-zinc-500 italic max-w-2xl mx-auto">
          "I love meeting fellow chili heads and hearing your feedback. If you see our stand, come say hi and try some of our latest creations!"
        </p>
      </div>
    </main>
  );
}
