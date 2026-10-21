"use server";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import crypto from "crypto";
import { headers } from "next/headers";
import { sendEmail } from "@/lib/emails/client";
import { getNewsletterVerificationHtml } from "@/lib/emails/templates";
import { getClientIp } from "@/lib/security/ip";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { isHoneypotTripped, isTooFast } from "@/lib/security/formGuards";
import { isDisposableOrRoleEmail } from "@/lib/security/email";
import { logRejection } from "@/lib/security/log";

// Admin client to manage signups table
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ROUTE = "newsletter.subscribe";
const GENERIC_ERROR = "Something went wrong. Please try again later.";

const SubscribeSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    locale: z.string().min(2).max(10),
    honeypot: z.string().max(200),
    renderedAt: z.number(),
  })
  .strict();

export async function subscribeToNewsletter(input: {
  email: string;
  locale: string;
  honeypot: string;
  renderedAt: number;
}) {
  const ip = await getClientIp();
  const parsed = SubscribeSchema.safeParse(input);

  if (!parsed.success) {
    logRejection({ route: ROUTE, ip, reason: "invalid_schema" });
    return { error: "Invalid email address" };
  }

  const { email, locale, honeypot, renderedAt } = parsed.data;

  if (isHoneypotTripped(honeypot)) {
    logRejection({ route: ROUTE, ip, reason: "honeypot" });
    return { error: GENERIC_ERROR };
  }

  if (isTooFast(renderedAt)) {
    logRejection({ route: ROUTE, ip, reason: "too_fast" });
    return { error: GENERIC_ERROR };
  }

  const [ipAllowed, emailAllowed] = await Promise.all([
    checkRateLimit({ key: `${ROUTE}:ip:${ip}`, windowSeconds: 3600, maxHits: 10 }),
    checkRateLimit({ key: `${ROUTE}:email:${email}`, windowSeconds: 86400, maxHits: 3 }),
  ]);

  if (!ipAllowed || !emailAllowed) {
    logRejection({ route: ROUTE, ip, reason: "rate_limited" });
    return { error: GENERIC_ERROR };
  }

  if (isDisposableOrRoleEmail(email)) {
    logRejection({ route: ROUTE, ip, reason: "disposable_email" });
    return { error: "Please use a permanent email address." };
  }

  try {
    // 1. Check if already confirmed or exists
    const { data: existing } = await supabaseAdmin
      .from("newsletter_signups")
      .select("confirmed_at")
      .eq("email", email)
      .maybeSingle();

    if (existing?.confirmed_at) {
      return { error: "This email is already subscribed!" };
    }

    // 2. Generate DOI token
    const token = crypto.randomBytes(32).toString("hex");
    const origin = (await headers()).get("origin");
    const confirmUrl = `${origin}/api/newsletter/confirm?token=${token}&locale=${locale}`;

    // 3. Upsert signup record
    const { error: upsertError } = await supabaseAdmin
      .from("newsletter_signups")
      .upsert({ email, token, confirmed_at: null }, { onConflict: "email" });

    if (upsertError) throw upsertError;

    // 4. Send Verification Email
    const { success, error: emailError } = await sendEmail({
      to: email,
      subject: "Action Required: Confirm your spicy subscription 🌶️",
      html: getNewsletterVerificationHtml(confirmUrl),
    });

    if (!success) {
      console.error("[Newsletter] Email send failed:", emailError);
      return { error: "Failed to send confirmation email. Please try again." };
    }

    return { success: true };
  } catch (err: any) {
    console.error("[Newsletter] Error:", err);
    return { error: "Something went wrong. Please try again later." };
  }
}
