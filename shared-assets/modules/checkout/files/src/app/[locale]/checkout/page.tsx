import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import CheckoutForm from "./components/CheckoutForm";
import { calculatePackageWeight } from "@/lib/shipping/config";
import { getShippingZonesForPricing } from "@/lib/checkout/shipping-zones";

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Checkout is allowed for guests, but we prefer them to be logged in
  // If we wanted to force login: if (!user) redirect(`/${locale}/auth/sign-in`);

  const cartSessionId = (await cookies()).get("cart_session_id")?.value;
  if (!cartSessionId) redirect(`/${locale}/cart`);

  // Fetch cart items (admin client — cart_items has no public RLS policy)
  const adminSupabase = createAdminClient();
  const { data: cartItems } = await adminSupabase
    .from("cart_items")
    .select("*, product:products(*), variant:product_variants(id, label, price_cents, sale_price_cents, weight_grams)")
    .eq("cart_session_id", cartSessionId);

  if (!cartItems || cartItems.length === 0) redirect(`/${locale}/cart`);

  // Calculate weight for shipping
  const weightItems = cartItems.map((item) => ({
    productName: item.product.name,
    quantity: item.quantity,
    capacityMl: item.product.capacity_ml,
    selectedSize: item.selected_size,
    weightGrams: (item.variant as any)?.weight_grams ?? item.product.weight_grams,
  }));
  const weightKg = calculatePackageWeight(weightItems);
  const zones = await getShippingZonesForPricing(adminSupabase);

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <CheckoutForm
        cartItems={cartItems}
        weightKg={weightKg}
        locale={locale}
        initialEmail={user?.email}
        zones={zones}
      />
    </div>
  );
}
