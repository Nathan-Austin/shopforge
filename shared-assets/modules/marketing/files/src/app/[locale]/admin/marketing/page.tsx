import { createClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Mail, Plus, Send, FileEdit, CheckCircle2, Clock, Users, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import DeleteDraftButton from "./DeleteDraftButton";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export default async function MarketingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const [{ data: campaigns }, { count: subscriberCount }] = await Promise.all([
    supabaseAdmin
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("mailing_list")
      .select("*", { count: "exact", head: true })
      .eq("status", "subscribed"),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Mail className="w-6 h-6 text-red-600" />
            Marketing Hub
          </h1>
          <p className="text-sm text-zinc-500 flex items-center gap-1 mt-1">
            <Users size={13} />
            {subscriberCount?.toLocaleString()} active subscribers
          </p>
        </div>
        <Button asChild className="bg-black text-white hover:bg-zinc-800">
          <Link href={`/${locale}/admin/marketing/new`}>
            <Plus className="mr-2 h-4 w-4" />
            New Newsletter
          </Link>
        </Button>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-zinc-50/50">
          <h2 className="font-bold text-sm uppercase tracking-wider text-zinc-500">
            Campaigns
          </h2>
        </div>
        <div className="divide-y">
          {!campaigns?.length ? (
            <div className="p-12 text-center text-zinc-500">
              <Mail className="mx-auto h-12 w-12 text-zinc-200 mb-4" />
              <p>No campaigns yet. Ready to send your first newsletter?</p>
            </div>
          ) : (
            campaigns.map((campaign) => {
              const isDraft = campaign.status === "draft";
              const details = (
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div
                    className={`p-2 rounded-lg ${
                      campaign.status === "sent"
                        ? "bg-green-50 text-green-600"
                        : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {campaign.status === "sent" ? (
                      <CheckCircle2 size={20} />
                    ) : (
                      <FileEdit size={20} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-zinc-900 truncate">{campaign.subject || "(No subject)"}</h3>
                    {campaign.preview_text && (
                      <p className="text-xs text-zinc-500 mt-0.5">{campaign.preview_text}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                          campaign.status === "sent"
                            ? "bg-green-50 text-green-700 border-green-100"
                            : "bg-zinc-50 text-zinc-600 border-zinc-200"
                        }`}
                      >
                        {campaign.status}
                      </span>
                      {campaign.recipient_count != null && (
                        <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                          <Send size={10} />
                          {campaign.recipient_count.toLocaleString()} sent
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                        <Clock size={10} />
                        {format(new Date(campaign.created_at), "MMM d, yyyy HH:mm")}
                      </span>
                    </div>
                  </div>
                </div>
              );

              return (
                <div
                  key={campaign.id}
                  className="p-6 hover:bg-zinc-50/50 transition-colors flex items-center justify-between gap-4"
                >
                  {isDraft ? (
                    <Link href={`/${locale}/admin/marketing/new?draft=${campaign.id}`} className="flex-1 min-w-0">
                      {details}
                    </Link>
                  ) : (
                    details
                  )}
                  {isDraft && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/${locale}/admin/marketing/new?draft=${campaign.id}`}
                        className="text-xs text-zinc-400 hover:text-brand-red flex items-center gap-1"
                      >
                        Continue editing <ArrowRight size={12} />
                      </Link>
                      <DeleteDraftButton draftId={campaign.id} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
