import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const resend = new Resend(process.env.RESEND_API_KEY);

// Keeps mailing_list in sync when a contact unsubscribes via Resend's own
// footer link (RESEND_UNSUBSCRIBE_URL) rather than our site's link, so the
// two systems don't drift apart.
export async function POST(req: NextRequest) {
  const payload = await req.text();
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing signature headers" }, { status: 400 });
  }

  let event;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,
    });
  } catch (err) {
    console.error("[ResendWebhook] Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "contact.updated" || event.type === "contact.deleted") {
    const { email, unsubscribed } = event.data;

    if (unsubscribed) {
      await supabaseAdmin
        .from("mailing_list")
        .update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() })
        .eq("email", email.toLowerCase());
    }
  }

  return NextResponse.json({ received: true });
}
