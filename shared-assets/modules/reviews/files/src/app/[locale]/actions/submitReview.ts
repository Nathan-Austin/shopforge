"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/security/ip";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { isHoneypotTripped, isTooFast } from "@/lib/security/formGuards";
import { isSameOrigin } from "@/lib/security/origin";
import { logRejection } from "@/lib/security/log";

const ROUTE = "reviews.submit";
const GENERIC_ERROR = "Something went wrong. Please try again.";

const SubmitReviewSchema = z
  .object({
    productId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    content: z.string().trim().min(1).max(2000),
    customerName: z.string().trim().max(100),
    honeypot: z.string().max(200),
    renderedAt: z.number(),
  })
  .strict();

interface Review {
  id: string;
  rating: number;
  title: string | null;
  content: string;
  customer_name: string;
  is_verified: boolean;
  created_at: string;
}

export async function submitReview(input: {
  productId: string;
  rating: number;
  content: string;
  customerName: string;
  honeypot: string;
  renderedAt: number;
}): Promise<{ error?: string; review?: Review }> {
  const ip = await getClientIp();

  if (!(await isSameOrigin())) {
    logRejection({ route: ROUTE, ip, reason: "bad_origin" });
    return { error: GENERIC_ERROR };
  }

  const parsed = SubmitReviewSchema.safeParse(input);
  if (!parsed.success) {
    logRejection({ route: ROUTE, ip, reason: "invalid_schema" });
    return { error: "Please check your review and try again." };
  }

  const { productId, rating, content, customerName, honeypot, renderedAt } = parsed.data;

  if (isHoneypotTripped(honeypot)) {
    logRejection({ route: ROUTE, ip, reason: "honeypot" });
    return { error: GENERIC_ERROR };
  }

  if (isTooFast(renderedAt)) {
    logRejection({ route: ROUTE, ip, reason: "too_fast" });
    return { error: GENERIC_ERROR };
  }

  // Uses the cookie-bound client (not the admin client) so RLS still
  // applies exactly as it did for the old client-side insert.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be logged in to submit a review." };
  }

  const allowed = await checkRateLimit({
    key: `${ROUTE}:user:${user.id}`,
    windowSeconds: 86400,
    maxHits: 5,
  });
  if (!allowed) {
    logRejection({ route: ROUTE, ip, reason: "rate_limited" });
    return { error: "You've submitted several reviews recently — please try again later." };
  }

  const { data: inserted, error } = await supabase
    .from("reviews")
    .insert({
      product_id: productId,
      user_id: user.id,
      rating,
      content,
      customer_name: customerName || user.email?.split("@")[0] || "Anonymous",
      is_verified: false,
    })
    .select("id, rating, title, content, customer_name, is_verified, created_at")
    .single();

  if (error) {
    return { error: GENERIC_ERROR };
  }

  return { review: inserted };
}
