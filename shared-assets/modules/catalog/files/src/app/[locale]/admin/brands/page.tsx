import { getTranslations } from "next-intl/server";
import { requireShopOwner } from "../lib/auth";
import BrandsClient from "./BrandsClient";

export const dynamic = "force-dynamic";

export default async function BrandsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: "Admin" });

  const { data: brands } = await supabase
    .from("brands")
    .select("*")
    .order("name");

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          Brand Management
        </h2>
        <p className="text-sm text-zinc-500">
          Add and manage your suppliers/brands.
        </p>
      </div>

      <BrandsClient brands={brands || []} locale={locale} />
    </div>
  );
}
