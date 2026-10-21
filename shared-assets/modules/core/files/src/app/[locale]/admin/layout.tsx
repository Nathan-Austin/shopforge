import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireShopOwner } from "./lib/auth";
import { createClient } from "@/lib/supabase/server";
import NotificationsBell from "./components/NotificationsBell";
import { ShieldCheck } from "lucide-react";

interface AdminLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

const NAV_ITEMS = [
  { key: "dashboard", path: "" },
  { key: "orders", path: "/orders" },
  { key: "products", path: "/products" },
  { key: "brands", path: "/brands" },
  { key: "events", path: "/events" },
  { key: "video_reviews", path: "/reviews" },
  { key: "analytics", path: "/analytics" },
  { key: "marketing", path: "/marketing" },
  { key: "vouchers", path: "/vouchers" },
  { key: "shipping", path: "/shipping" },
];

export default async function AdminLayout({
  children,
  params,
}: AdminLayoutProps) {
  const { locale } = await params;
  await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: "Admin" });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen w-full bg-stone-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-6xl mx-auto flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between md:py-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-600 font-semibold">
              {t("title")}
            </p>
            <h1 className="text-xl font-bold text-foreground md:text-2xl">
              {t("dashboardHeading")}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <nav className="flex items-center gap-2 text-sm overflow-x-auto pb-1 md:pb-0 md:flex-wrap md:gap-3 scrollbar-none">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.key}
                  href={`/${locale}/admin${item.path}`}
                  className="rounded-full border border-border px-3 py-1 text-xs whitespace-nowrap hover:border-brand-red hover:text-brand-red transition-colors md:px-4 md:py-1.5 md:text-sm"
                >
                  {t(`nav.${item.key}`)}
                </Link>
              ))}
            </nav>
            <Link
              href={`/${locale}/auth/mfa-setup`}
              title="Manage two-factor authentication"
              className="text-stone-600 hover:text-brand-red transition-colors"
            >
              <ShieldCheck className="h-5 w-5" />
            </Link>
            {user && <NotificationsBell userId={user.id} />}
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-4 md:py-8">{children}</main>
    </div>
  );
}
