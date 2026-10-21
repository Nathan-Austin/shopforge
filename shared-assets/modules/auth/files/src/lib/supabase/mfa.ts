import type { SupabaseClient } from "@supabase/supabase-js";

export type MfaStatus =
  | { state: "needs_enrollment" }
  | { state: "needs_verification"; factorId: string }
  | { state: "satisfied" };

export async function getMfaStatus(
  supabase: SupabaseClient,
): Promise<MfaStatus> {
  const { data: aal, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (error || !aal) return { state: "needs_enrollment" };

  if (aal.currentLevel === "aal2" && aal.nextLevel === "aal2") {
    return { state: "satisfied" };
  }

  if (aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factorId = factors?.totp?.[0]?.id;
    if (factorId) return { state: "needs_verification", factorId };
    return { state: "needs_enrollment" };
  }

  return { state: "needs_enrollment" };
}

export async function cleanupStaleUnverifiedTotpFactors(
  supabase: SupabaseClient,
): Promise<void> {
  const { data } = await supabase.auth.mfa.listFactors();
  const unverified = (data?.all ?? []).filter(
    (f) => f.factor_type === "totp" && f.status === "unverified",
  );

  for (const factor of unverified) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id }).catch(() => {});
  }
}
