"use client";

import { useTransition } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { deleteCampaignDraft } from "./actions";

export default function DeleteDraftButton({ draftId }: { draftId: string }) {
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirm("Discard this draft? This can't be undone.")) return;
    startTransition(async () => {
      const res = await deleteCampaignDraft(draftId);
      if (res.error) alert(res.error);
    });
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={isPending}
      className="p-1.5 rounded hover:bg-red-50 text-zinc-400 hover:text-red-600 transition-colors disabled:opacity-50"
      title="Discard draft"
    >
      {isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
    </button>
  );
}
