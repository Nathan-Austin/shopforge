"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/security/ip";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { isSameOrigin } from "@/lib/security/origin";
import { logRejection } from "@/lib/security/log";

const ROUTE = "profile.update";

const nullableString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const UpdateProfileSchema = z.object({
  first_name: nullableString(100),
  last_name: nullableString(100),
  phone: nullableString(30),
  date_of_birth: nullableString(20),
  street: nullableString(200),
  city: nullableString(120),
  postal_code: nullableString(20),
  country: nullableString(3),
});

export async function updateProfile(
  { locale }: { locale: string },
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  const ip = await getClientIp();

  if (!(await isSameOrigin())) {
    logRejection({ route: ROUTE, ip, reason: "bad_origin" });
    return { error: "Invalid request" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const allowed = await checkRateLimit({
    key: `${ROUTE}:user:${user.id}`,
    windowSeconds: 3600,
    maxHits: 20,
  });
  if (!allowed) {
    logRejection({ route: ROUTE, ip, reason: "rate_limited" });
    return { error: "Too many requests. Please try again later." };
  }

  const parsed = UpdateProfileSchema.safeParse({
    first_name: formData.get("first_name")?.toString(),
    last_name: formData.get("last_name")?.toString(),
    phone: formData.get("phone")?.toString(),
    date_of_birth: formData.get("date_of_birth")?.toString(),
    street: formData.get("street")?.toString(),
    city: formData.get("city")?.toString(),
    postal_code: formData.get("postal_code")?.toString(),
    country: formData.get("country")?.toString(),
  });

  if (!parsed.success) {
    logRejection({ route: ROUTE, ip, reason: "invalid_schema" });
    return { error: "Please check your details and try again." };
  }

  const {
    first_name: firstName,
    last_name: lastName,
    phone,
    date_of_birth: dateOfBirth,
    street,
    city,
    postal_code: postalCode,
    country,
  } = parsed.data;

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      first_name: firstName,
      last_name: lastName,
      phone,
      date_of_birth: dateOfBirth,
      country,
    })
    .eq("id", user.id);

  if (profileError) {
    console.error("[Profile] Failed to update profile:", profileError);
    return { error: "Failed to save profile" };
  }

  const { data: existingAddress } = await supabase
    .from("addresses")
    .select("id")
    .eq("user_id", user.id)
    .eq("label", "Default")
    .maybeSingle();

  const addressPayload = {
    user_id: user.id,
    label: "Default",
    street,
    city,
    postal_code: postalCode,
    country,
  };

  const { error: addressError } = existingAddress
    ? await supabase
        .from("addresses")
        .update(addressPayload)
        .eq("id", existingAddress.id)
    : await supabase.from("addresses").insert(addressPayload);

  if (addressError) {
    console.error("[Profile] Failed to save address:", addressError);
    return { error: "Failed to save address" };
  }

  revalidatePath(`/${locale}/account`);
  return { success: "saved" };
}
