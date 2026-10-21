import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: existingProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError && profileError.code !== "PGRST116") {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  // Roles can't be self-assigned (guard_profile_role, 0188): new profiles are
  // always customers; owners are promoted via the SQL editor / service role.
  const role = existingProfile?.role || "customer";

  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, role }, { onConflict: "id" })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ profile: data });
}
