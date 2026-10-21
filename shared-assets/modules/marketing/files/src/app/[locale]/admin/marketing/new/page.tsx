import { createClient } from "@supabase/supabase-js";
import EmailBuilder from "./EmailBuilder";
import type { Block } from "@/lib/emails/newsletter-builder";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export default async function NewCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ draft?: string }>;
}) {
  const { locale } = await params;
  const { draft: draftId } = await searchParams;

  const [{ data: products }, { count: subscriberCount }, draftResult] = await Promise.all([
    supabaseAdmin
      .from("products")
      .select("id, name, slug, image_url, price_cents")
      .eq("is_active", true)
      .order("name"),
    supabaseAdmin
      .from("mailing_list")
      .select("*", { count: "exact", head: true })
      .eq("status", "subscribed"),
    draftId
      ? supabaseAdmin.from("campaigns").select("id, subject, blocks").eq("id", draftId).eq("status", "draft").single()
      : Promise.resolve({ data: null }),
  ]);

  const draft = draftResult?.data;

  return (
    <div className="py-6">
      <EmailBuilder
        locale={locale}
        products={products || []}
        subscriberCount={subscriberCount || 0}
        initialDraftId={draft?.id ?? null}
        initialSubject={draft?.subject ?? ""}
        initialBlocks={(draft?.blocks as Block[] | undefined) ?? []}
      />
    </div>
  );
}
