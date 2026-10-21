import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getLocalizedField } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Reviews" });
  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

export default async function ReviewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Reviews" });
  const supabase = await createClient();

  const { data: reviews } = await supabase
    .from("video_reviews")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  return (
    <main className="max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-extrabold text-foreground sm:text-5xl tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-4 text-xl text-text-muted max-w-2xl mx-auto">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {(reviews ?? []).map((video) => {
          const title = getLocalizedField(video, "title", locale);
          return (
            <div key={video.id} className="flex flex-col gap-4">
              <div className="relative aspect-video rounded-2xl overflow-hidden shadow-lg border border-border">
                <iframe
                  src={`https://www.youtube.com/embed/${video.youtube_id}`}
                  title={title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="absolute inset-0 w-full h-full border-0"
                />
              </div>
              <div>
                <h3 className="font-bold text-lg text-foreground leading-snug px-1">
                  {title}
                </h3>
                {video.reviewer && (
                  <p className="text-sm text-text-muted px-1 mt-1">
                    {video.reviewer}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
