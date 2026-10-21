import { createAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { formatPrice, formatVolume } from "@/lib/format";
import { getEffectivePriceCents } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Trash2, Minus, Plus, ShoppingBag, ArrowRight } from "lucide-react";
import { removeFromCart, updateCartQuantity } from "./actions";
import { redirect } from "next/navigation";

export default async function CartPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("Cart");
  const supabase = createAdminClient();
  const cartSessionId = (await cookies()).get("cart_session_id")?.value;

  let cartItems = [];
  if (cartSessionId) {
    const { data } = await supabase
      .from("cart_items")
      .select("*, product:products(*), variant:product_variants(id, label, price_cents, sale_price_cents, weight_grams)")
      .eq("cart_session_id", cartSessionId)
      .order("created_at", { ascending: true });
    cartItems = data || [];
  }

  const subtotal = cartItems.reduce(
    (acc, item) => acc + getEffectivePriceCents(item.product, item.variant as any) * item.quantity,
    0,
  );
  const itemCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);

  if (cartItems.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <div className="flex justify-center mb-6">
          <div className="bg-zinc-100 p-6 rounded-full">
            <ShoppingBag className="w-12 h-12 text-zinc-400" />
          </div>
        </div>
        <h1 className="text-2xl font-bold mb-4">{t("empty")}</h1>
        <Button asChild>
          <Link href={`/${locale}/shop`}>{t("continueShopping")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <h1 className="text-3xl font-bold mb-8">{t("title")}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Cart Items List */}
        <div className="lg:col-span-2 space-y-6">
          {cartItems.map((item) => (
            <div
              key={item.id}
              className="flex gap-4 p-4 bg-white rounded-xl border shadow-sm"
            >
              <div className="relative w-24 h-24 bg-zinc-50 rounded-lg overflow-hidden flex-shrink-0">
                {item.product.image_url ? (
                  <Image
                    src={item.product.image_url}
                    alt={item.product.name}
                    fill
                    className="object-contain p-2"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-2xl">
                    🌶️
                  </div>
                )}
              </div>

              <div className="flex-grow flex flex-col justify-between py-1">
                <div>
                  <div className="flex justify-between items-start">
                    <h3 className="font-bold text-lg hover:text-red-600 transition-colors">
                      <Link href={`/${locale}/shop/${item.product.slug}`}>
                        {item.product.name}
                      </Link>
                    </h3>
                    <form
                      action={async () => {
                        "use server";
                        await removeFromCart(item.id);
                      }}
                    >
                      <button
                        type="submit"
                        className="text-zinc-400 hover:text-red-600 p-1"
                      >
                        <Trash2 size={18} />
                      </button>
                    </form>
                  </div>
                  {(item.variant as any)?.label ? (
                    <p className="text-xs text-zinc-500 font-medium">
                      {(item.variant as any).label}
                    </p>
                  ) : formatVolume(item.product) ? (
                    <p className="text-xs text-zinc-500">
                      {formatVolume(item.product)}
                    </p>
                  ) : null}
                </div>

                <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:justify-between sm:items-end">
                  <div className="flex items-center border rounded-lg overflow-hidden h-9">
                    <form
                      action={async () => {
                        "use server";
                        await updateCartQuantity(item.id, item.quantity - 1);
                      }}
                    >
                      <button
                        type="submit"
                        className="px-3 h-full hover:bg-zinc-50 border-r transition-colors"
                      >
                        <Minus size={14} />
                      </button>
                    </form>
                    <span className="px-4 font-medium text-sm">
                      {item.quantity}
                    </span>
                    <form
                      action={async () => {
                        "use server";
                        await updateCartQuantity(item.id, item.quantity + 1);
                      }}
                    >
                      <button
                        type="submit"
                        className="px-3 h-full hover:bg-zinc-50 border-l transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                    </form>
                  </div>
                  <p className="font-bold text-lg self-end sm:self-auto">
                    {formatPrice(
                      getEffectivePriceCents(item.product, item.variant as any) * item.quantity,
                      item.product.currency,
                      locale,
                    )}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary Sidebar */}
        <div className="lg:col-span-1">
          <div className="bg-zinc-50 rounded-xl p-6 border sticky top-24">
            <h2 className="text-xl font-bold mb-6">{t("summary")}</h2>

            <div className="space-y-4 mb-6">
              <div className="flex justify-between text-zinc-600">
                <span>
                  {t("subtotal")} ({itemCount}{" "}
                  {itemCount === 1 ? t("item") : t("items")})
                </span>
                <span className="font-semibold text-zinc-900">
                  {formatPrice(subtotal, "EUR", locale)}
                </span>
              </div>
              <div className="flex justify-between text-zinc-600">
                <span>{t("shipping")}</span>
                <span className="text-xs italic text-zinc-500">
                  {t("shippingNote")}
                </span>
              </div>
              <div className="border-t pt-4 flex justify-between items-baseline">
                <span className="text-lg font-bold">{t("total")}</span>
                <div className="text-right">
                  <span className="text-2xl font-bold text-red-600">
                    {formatPrice(subtotal, "EUR", locale)}*
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-zinc-400 text-right mt-1">
                * {t("shippingNote")}
              </p>
            </div>

            <Button
              asChild
              className="w-full h-12 text-lg font-bold bg-black hover:bg-zinc-800"
              size="lg"
            >
              <Link href={`/${locale}/checkout`}>
                {t("checkout")} <ArrowRight className="ml-2 w-5 h-5" />
              </Link>
            </Button>

            <Link
              href={`/${locale}/shop`}
              className="block text-center mt-6 text-sm font-medium text-zinc-500 hover:text-zinc-800 transition-colors"
            >
              {t("continueShopping")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
