import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/format";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ProfileSection from "@/components/account/ProfileSection";

export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const t = await getTranslations("Account");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${locale}/auth/sign-in`);
  }

  // Fetch profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // Fetch default address
  const { data: address } = await supabase
    .from("addresses")
    .select("*")
    .eq("user_id", user.id)
    .eq("label", "Default")
    .maybeSingle();

  // Fetch latest orders
  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-zinc-900">{t("title")}</h1>
        <p className="mt-2 text-zinc-600">
          {t("welcome", {
            name: profile?.first_name || user.email?.split("@")[0] || "Friend",
          })}
        </p>
      </div>

      {/* Profile Info */}
      <div className="mb-8">
        <ProfileSection
          locale={locale}
          email={user.email || ""}
          role={profile?.role || "customer"}
          initialValues={{
            firstName: profile?.first_name || "",
            lastName: profile?.last_name || "",
            phone: profile?.phone || "",
            dateOfBirth: profile?.date_of_birth || "",
            street: address?.street || "",
            city: address?.city || "",
            postalCode: address?.postal_code || "",
            country: address?.country || profile?.country || "",
          }}
        />
      </div>

      <div>
        {/* Recent Orders */}
        <div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t("orders.title")}</CardTitle>
              {orders && orders.length > 0 && (
                <Link
                  href={`/${locale}/account/orders`}
                  className="text-sm font-bold text-brand-red hover:underline"
                >
                  {t("orders.viewAll")}
                </Link>
              )}
            </CardHeader>
            <CardContent>
              {!orders || orders.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-zinc-500">{t("orders.empty")}</p>
                  <Link
                    href={`/${locale}/shop`}
                    className="mt-4 inline-block font-bold text-brand-red hover:underline"
                  >
                    Go to shop
                  </Link>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-zinc-100 text-xs font-bold uppercase tracking-wider text-zinc-400">
                      <tr>
                        <th className="pb-3 pr-4">{t("orders.orderNumber")}</th>
                        <th className="pb-3 pr-4">{t("orders.date")}</th>
                        <th className="pb-3 pr-4">{t("orders.status")}</th>
                        <th className="pb-3 pr-4 text-right">
                          {t("orders.total")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {orders.map((order) => (
                        <tr key={order.id}>
                          <td className="py-4 pr-4 font-mono text-xs text-zinc-500">
                            {order.id.split("-")[0].toUpperCase()}
                          </td>
                          <td className="py-4 pr-4">
                            {new Date(order.created_at).toLocaleDateString(
                              locale,
                            )}
                          </td>
                          <td className="py-4 pr-4">
                            <Badge
                              variant="outline"
                              className={
                                order.status === "paid"
                                  ? "border-green-200 bg-green-50 text-green-700"
                                  : order.status === "shipped"
                                    ? "border-blue-200 bg-blue-50 text-blue-700"
                                    : ""
                              }
                            >
                              {order.status}
                            </Badge>
                          </td>
                          <td className="py-4 pr-4 text-right font-bold text-zinc-900">
                            {formatPrice(
                              order.total_cents,
                              order.currency,
                              locale,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
