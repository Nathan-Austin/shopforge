import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isShopOwner = false;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    isShopOwner = profile?.role === "shop_owner";
  }

  const cartSessionId = (await cookies()).get("cart_session_id")?.value;
  let cartCount = 0;
  if (cartSessionId) {
    const adminSupabase = createAdminClient();
    const { data: cartItems } = await adminSupabase
      .from("cart_items")
      .select("quantity")
      .eq("cart_session_id", cartSessionId);
    cartCount = cartItems?.reduce((acc, item) => acc + item.quantity, 0) ?? 0;
  }

  return Response.json(
    { isLoggedIn: !!user, isShopOwner, cartCount },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
