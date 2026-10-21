import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/emails/client";
import { getNewsletterWelcomeHtml } from "@/lib/emails/templates";
import { subscribeToMailingList } from "@/lib/marketing/mailing-list";
import { createOneTimeDiscountCode } from "@/lib/vouchers/createOneTimeDiscountCode";
import { getClientIp } from "@/lib/security/ip";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { logRejection } from "@/lib/security/log";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ROUTE = "newsletter.confirm";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  const locale = searchParams.get("locale") || "en";
  const ip = await getClientIp();

  if (!token) {
    logRejection({ route: ROUTE, ip, reason: "missing_token" });
    return NextResponse.redirect(
      new URL(`/${locale}?error=invalid_token`, req.url),
    );
  }

  const allowed = await checkRateLimit({
    key: `${ROUTE}:ip:${ip}`,
    windowSeconds: 3600,
    maxHits: 20,
  });
  if (!allowed) {
    logRejection({ route: ROUTE, ip, reason: "rate_limited" });
    return NextResponse.redirect(
      new URL(`/${locale}?error=rate_limited`, req.url),
    );
  }

  try {
    // 1. Verify token and find signup
    const { data: signup, error: fetchError } = await supabaseAdmin
      .from("newsletter_signups")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (fetchError || !signup) {
      logRejection({ route: ROUTE, ip, reason: "token_not_found" });
      return NextResponse.redirect(
        new URL(`/${locale}?error=not_found`, req.url),
      );
    }

    if (signup.confirmed_at) {
      return NextResponse.redirect(
        new URL(`/${locale}?status=already_confirmed`, req.url),
      );
    }

    // 2. Update status to confirmed
    await supabaseAdmin
      .from("newsletter_signups")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("id", signup.id);

    // 3. Add to mailing list
    await subscribeToMailingList({
      email: signup.email,
      source: "newsletter_signup",
    });

    // 4. Send welcome email with a one-time discount code
    const codeResult = await createOneTimeDiscountCode({
      email: signup.email,
      source: "newsletter_welcome",
    });
    await sendEmail({
      to: signup.email,
      subject: "Welcome! Here is your 10% discount code 🎁",
      html: getNewsletterWelcomeHtml("error" in codeResult ? null : codeResult.code),
    });

    // 5. Redirect to home with success state
    return NextResponse.redirect(
      new URL(`/${locale}?status=newsletter_confirmed`, req.url),
    );
  } catch (err) {
    console.error("[Newsletter Confirm] Error:", err);
    return NextResponse.redirect(
      new URL(`/${locale}?error=server_error`, req.url),
    );
  }
}
