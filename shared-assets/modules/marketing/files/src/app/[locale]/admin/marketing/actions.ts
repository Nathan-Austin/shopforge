"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { ensureShopOwner } from "../lib/auth";
import type { Block } from "@/lib/emails/newsletter-builder";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Campaign sending is handled via /api/admin/send-campaign route.

export async function saveCampaignDraft(
  draftId: string | null,
  input: { subject: string; blocks: Block[] },
) {
  const { error: authError, user } = await ensureShopOwner();
  if (authError || !user) return { error: authError ?? "Forbidden" };

  if (!input.subject.trim() && input.blocks.length === 0) {
    return { error: "Nothing to save yet." };
  }

  if (draftId) {
    // Only ever overwrite a row that's still a draft -- never touch an
    // already-sent campaign, even if a stale draftId somehow got reused.
    const { data, error } = await supabaseAdmin
      .from("campaigns")
      .update({ subject: input.subject, blocks: input.blocks })
      .eq("id", draftId)
      .eq("status", "draft")
      .select("id")
      .single();

    if (error || !data) {
      return { error: "This draft no longer exists (it may have already been sent)." };
    }

    revalidatePath("/[locale]/admin/marketing", "page");
    return { error: null, draftId: data.id as string };
  }

  const { data, error } = await supabaseAdmin
    .from("campaigns")
    .insert({
      subject: input.subject,
      blocks: input.blocks,
      status: "draft",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to save draft." };

  revalidatePath("/[locale]/admin/marketing", "page");
  return { error: null, draftId: data.id as string };
}

export async function deleteCampaignDraft(draftId: string) {
  const { error: authError } = await ensureShopOwner();
  if (authError) return { error: authError ?? "Forbidden" };

  const { error } = await supabaseAdmin
    .from("campaigns")
    .delete()
    .eq("id", draftId)
    .eq("status", "draft");

  if (error) return { error: error.message };

  revalidatePath("/[locale]/admin/marketing", "page");
  return { error: null };
}
