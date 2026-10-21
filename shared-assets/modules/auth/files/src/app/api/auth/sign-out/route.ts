import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const referer = request.headers.get("referer") ?? "/";
  return NextResponse.redirect(referer, { status: 303 });
}
