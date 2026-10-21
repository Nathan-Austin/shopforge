"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/security/ip";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { isHoneypotTripped, isTooFast } from "@/lib/security/formGuards";
import { isDisposableOrRoleEmail } from "@/lib/security/email";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { isSameOrigin } from "@/lib/security/origin";
import { logRejection } from "@/lib/security/log";

const GENERIC_ERROR = "Something went wrong. Please try again later.";
const VERIFICATION_FAILED = "Verification failed. Please try again.";

type GuardInput = {
  honeypot: string;
  renderedAt: number;
  turnstileToken: string;
};

/**
 * Shared guard stack for both auth flows below. Returns an error string if
 * the submission should be rejected, or null if it's clear to proceed.
 */
async function runGuards(route: string, ip: string, input: GuardInput): Promise<string | null> {
  if (!(await isSameOrigin())) {
    logRejection({ route, ip, reason: "bad_origin" });
    return GENERIC_ERROR;
  }

  if (isHoneypotTripped(input.honeypot)) {
    logRejection({ route, ip, reason: "honeypot" });
    return GENERIC_ERROR;
  }

  if (isTooFast(input.renderedAt)) {
    logRejection({ route, ip, reason: "too_fast" });
    return GENERIC_ERROR;
  }

  const turnstileOk = await verifyTurnstile(input.turnstileToken, ip);
  if (!turnstileOk) {
    logRejection({ route, ip, reason: "invalid_turnstile" });
    return VERIFICATION_FAILED;
  }

  return null;
}

const SignUpSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8).max(128),
    honeypot: z.string().max(200),
    renderedAt: z.number(),
    turnstileToken: z.string().min(1),
  })
  .strict();

export async function signUp(input: {
  email: string;
  password: string;
  honeypot: string;
  renderedAt: number;
  turnstileToken: string;
}): Promise<{ error?: string; success?: boolean }> {
  const ROUTE = "auth.signUp";
  const ip = await getClientIp();

  const parsed = SignUpSchema.safeParse(input);
  if (!parsed.success) {
    logRejection({ route: ROUTE, ip, reason: "invalid_schema" });
    return { error: "Please check your details and try again." };
  }

  const { email, password, ...guardFields } = parsed.data;

  const guardError = await runGuards(ROUTE, ip, guardFields);
  if (guardError) return { error: guardError };

  const [ipAllowed, emailAllowed] = await Promise.all([
    checkRateLimit({ key: `${ROUTE}:ip:${ip}`, windowSeconds: 3600, maxHits: 5 }),
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

  // No emailRedirectTo here: the confirmation email contains a 6-digit code
  // ({{ .Token }} in the Supabase email template), not a link, so Outlook/MS
  // safe-link scanners can't pre-fetch and burn the one-time code before the
  // user opens it. The code is entered on sign-up/page.tsx and exchanged
  // client-side via supabase.auth.verifyOtp({ type: "signup" }).
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) return { error: error.message };
  return { success: true };
}

const ResetPasswordSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    locale: z.string().min(2).max(10),
    honeypot: z.string().max(200),
    renderedAt: z.number(),
    turnstileToken: z.string().min(1),
  })
  .strict();

const RESET_INFO = "If your email exists, you will receive instructions shortly.";

export async function requestPasswordReset(input: {
  email: string;
  locale: string;
  honeypot: string;
  renderedAt: number;
  turnstileToken: string;
}): Promise<{ error?: string; info?: string }> {
  const ROUTE = "auth.requestPasswordReset";
  const ip = await getClientIp();

  const parsed = ResetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    logRejection({ route: ROUTE, ip, reason: "invalid_schema" });
    return { error: "Please check your details and try again." };
  }

  const { email, ...guardFields } = parsed.data;

  const guardError = await runGuards(ROUTE, ip, guardFields);
  if (guardError) return { error: guardError };

  const [ipAllowed, emailAllowed] = await Promise.all([
    checkRateLimit({ key: `${ROUTE}:ip:${ip}`, windowSeconds: 3600, maxHits: 5 }),
    checkRateLimit({ key: `${ROUTE}:email:${email}`, windowSeconds: 86400, maxHits: 3 }),
  ]);
  if (!ipAllowed || !emailAllowed) {
    logRejection({ route: ROUTE, ip, reason: "rate_limited" });
    return { error: GENERIC_ERROR };
  }

  // Deliberately no disposable-email rejection here — it wouldn't reduce
  // abuse (this doesn't gate on account existence) and would only block
  // legitimate recovery for anyone who originally signed up with such an
  // address.

  // No redirectTo here: the recovery email contains a 6-digit code
  // ({{ .Token }} in the Supabase email template), not a link, so Outlook/MS
  // safe-link scanners can't pre-fetch and burn the one-time code before the
  // user opens it. The code is entered on reset-password/page.tsx and
  // exchanged client-side via supabase.auth.verifyOtp({ type: "recovery" }).
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email);

  // Always the same message, regardless of whether the account exists —
  // Supabase's own response already avoids leaking this too.
  return { info: RESET_INFO };
}
