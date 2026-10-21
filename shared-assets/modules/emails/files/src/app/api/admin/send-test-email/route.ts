import { NextRequest, NextResponse } from "next/server";
import { ensureShopOwner } from "@/app/[locale]/admin/lib/auth";
import { sendEmail } from "@/lib/emails/client";
import {
  generateNewsletterHtml,
  generateUnsubscribeToken,
  type Block,
} from "@/lib/emails/newsletter-builder";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://example.com";

export async function POST(req: NextRequest) {
  const { error: authError, user } = await ensureShopOwner();
  if (authError || !user) {
    const status = authError === "UNAUTHENTICATED" ? 401 : 403;
    const message =
      authError === "MFA_REQUIRED"
        ? "Two-factor authentication required — please complete MFA verification and try again."
        : "Not authorized";
    return NextResponse.json({ error: message }, { status });
  }

  const { subject, blocks, recipients } = (await req.json()) as {
    subject: string;
    blocks: Block[];
    recipients: string[];
  };

  if (!subject || !blocks?.length) {
    return NextResponse.json({ error: "Subject and blocks are required" }, { status: 400 });
  }
  if (!recipients?.length) {
    return NextResponse.json({ error: "Select at least one test recipient" }, { status: 400 });
  }

  const results = await Promise.all(
    recipients.map(async (email) => {
      const token = generateUnsubscribeToken(email);
      const unsubscribeUrl = `${SITE_URL}/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
      const html = generateNewsletterHtml({
        blocks,
        unsubscribeUrl,
        siteUrl: SITE_URL,
      });
      const { success } = await sendEmail({
        to: email,
        subject: `[TEST] ${subject}`,
        html,
      });
      return { email, success };
    }),
  );

  const failed = results.filter((r) => !r.success).map((r) => r.email);
  if (failed.length) {
    return NextResponse.json({ error: `Failed to send to: ${failed.join(", ")}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, sentTo: recipients });
}
