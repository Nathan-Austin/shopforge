import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: reverted, error } = await supabaseAdmin.rpc("process_away_mode_return");

  if (error) {
    console.error("[Cron:AwayModeReturn] Failed:", error);
    return NextResponse.json({ error: "Failed to process away mode return" }, { status: 500 });
  }

  console.log(`[Cron:AwayModeReturn] reverted=${!!reverted}`);
  return NextResponse.json({ reverted: !!reverted });
}
