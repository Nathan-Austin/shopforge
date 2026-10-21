import { Suspense } from "react";
import { getStripeServerClient } from "@/lib/stripe/server";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/format";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { CheckCircle2, Package, Mail, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SuccessPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ session_id?: string }>;
}

export default async function SuccessPage({
  params,
  searchParams,
}: SuccessPageProps) {
  const { locale } = await params;
  const { session_id } = await searchParams;
  const t = await getTranslations("Checkout.Success");

  if (!session_id) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">{t("invalidSession")}</h1>
        <Button asChild>
          <Link href={`/${locale}/shop`}>{t("backToShop")}</Link>
        </Button>
      </div>
    );
  }

  const stripe = getStripeServerClient();
  const supabase = await createClient();

  // 1. Retrieve Stripe Session
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(session_id);
  } catch (err) {
    console.error("Error retrieving stripe session:", err);
  }

  // 2. Fetch Order from Supabase
  const { data: order } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("stripe_session_id", session_id)
    .single();

  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl">
      <div className="bg-white rounded-xl shadow-sm border p-8 md:p-12 text-center">
        <div className="flex justify-center mb-6">
          <CheckCircle2 className="w-20 h-20 text-green-500" />
        </div>

        <h1 className="text-3xl font-bold mb-2">{t("title")}</h1>
        <p className="text-gray-600 mb-8">
          {t("description", {
            email: order?.customer_email || session?.customer_details?.email,
          })}
        </p>

        {order && (
          <div className="bg-gray-50 rounded-lg p-6 mb-8 text-left">
            <div className="flex items-center justify-between mb-4 pb-4 border-bottom">
              <span className="font-semibold text-sm uppercase text-gray-500 tracking-wider">
                {t("orderNumber")}
              </span>
              <span className="font-mono font-bold text-red-600">
                #{(order as any).order_number ?? order.id.slice(0, 8).toUpperCase()}
              </span>
            </div>

            <div className="space-y-4 mb-6">
              {order.order_items?.map((item: any, idx: number) => (
                <div
                  key={idx}
                  className="flex justify-between items-center text-sm"
                >
                  <span className="text-gray-700">
                    <span className="font-bold">{item.quantity}x</span>{" "}
                    {item.product_name}
                  </span>
                  <span className="font-medium">
                    {formatPrice(item.price_cents * item.quantity)}
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t("subtotal")}</span>
                <span>{formatPrice(order.subtotal_cents)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{t("shipping")}</span>
                <span>{formatPrice(order.shipping_cents)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold pt-2 border-t mt-2">
                <span>{t("total")}</span>
                <span className="text-red-600">
                  {formatPrice(order.total_cents)}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-start gap-4 p-4 border rounded-lg text-left">
            <div className="bg-red-100 p-2 rounded-full text-red-600">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm">{t("shippingInfo")}</h3>
              <p className="text-xs text-gray-500">
                {t("shippingDescription")}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 border rounded-lg text-left">
            <div className="bg-blue-100 p-2 rounded-full text-blue-600">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm">{t("support")}</h3>
              <p className="text-xs text-gray-500">hello@example.com</p>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
          <Button asChild size="lg">
            <Link href={`/${locale}/shop`}>
              {t("continueShopping")} <ArrowRight className="ml-2 w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
