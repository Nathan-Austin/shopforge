import { NextRequest, NextResponse } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/emails/newsletter-builder";
import { unsubscribeFromMailingList } from "@/lib/marketing/mailing-list";
import { getClientIp } from "@/lib/security/ip";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { logRejection } from "@/lib/security/log";

const ROUTE = "newsletter.unsubscribe";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email");
  const token = searchParams.get("token");
  const ip = await getClientIp();

  const allowed = await checkRateLimit({
    key: `${ROUTE}:ip:${ip}`,
    windowSeconds: 3600,
    maxHits: 20,
  });
  if (!allowed) {
    logRejection({ route: ROUTE, ip, reason: "rate_limited" });
    return new NextResponse("Too many requests. Please try again later.", { status: 429 });
  }

  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    logRejection({ route: ROUTE, ip, reason: "invalid_token" });
    return new NextResponse("Invalid unsubscribe link.", { status: 400 });
  }

  await unsubscribeFromMailingList(email);

  return new NextResponse(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px 20px;">
      <h2>You've been unsubscribed.</h2>
      <p style="color:#666;">You won't receive any more marketing emails from Your Store.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}
