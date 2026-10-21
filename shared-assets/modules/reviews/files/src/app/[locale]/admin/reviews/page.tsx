import { getTranslations } from "next-intl/server";
import { requireShopOwner } from "../lib/auth";
import ReviewsClient from "./ReviewsClient";

export const dynamic = "force-dynamic";

export default async function AdminReviewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: "Admin" });

  const { data: reviews } = await supabase
    .from("video_reviews")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          Video Reviews Management
        </h2>
        <p className="text-sm text-zinc-500">
          Add or remove YouTube reviews for the reviews page.
        </p>
      </div>

      <ReviewsClient reviews={reviews || []} />
    </div>
  );
}
