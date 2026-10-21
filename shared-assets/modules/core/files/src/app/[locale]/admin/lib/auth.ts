import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMfaStatus } from "@/lib/supabase/mfa";

export async function requireShopOwner(locale: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${locale}/auth/sign-in`);
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error || profile?.role !== "shop_owner") {
    redirect(`/${locale}`);
  }

  const mfa = await getMfaStatus(supabase);
  if (mfa.state === "needs_enrollment") {
    redirect(`/${locale}/auth/mfa-setup`);
  }
  if (mfa.state === "needs_verification") {
    redirect(`/${locale}/auth/mfa-verify`);
  }

  return { supabase, user };
}

export async function ensureShopOwner() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "UNAUTHENTICATED" as const, supabase: null, user: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "shop_owner") {
    return { error: "FORBIDDEN" as const, supabase: null, user: null };
  }

  const mfa = await getMfaStatus(supabase);
  if (mfa.state !== "satisfied") {
    return { error: "MFA_REQUIRED" as const, supabase: null, user: null };
  }

  return { error: null, supabase, user };
}
