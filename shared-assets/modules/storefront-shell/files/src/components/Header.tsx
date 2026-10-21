import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import HeaderActions from "./HeaderActions";
import ShopNavVisibility from "./ShopNavVisibility";

export default async function Header({ locale }: { locale: string }) {
  const tAuth = await getTranslations("Auth");
  const tNav = await getTranslations("Nav");
  const t = await getTranslations("Header");

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
  const initialSession = { isLoggedIn: !!user, isShopOwner };
  const shop = `/${locale}/shop`;

  return (
    <>
      <div className="store-promise">
        <span>{t("promise")}</span>
        <span>{t("service")}</span>
      </div>
      <header className="store-header pt-[env(safe-area-inset-top)]">
        <div className="header-main">
          <Link href={`/${locale}`} aria-label="Your Store home">
            <Image
              src="/images/logo.png"
              alt="Your Store"
              width={135}
              height={54}
              priority
            />
          </Link>

          <nav className="desktop-nav" aria-label="Main navigation">
            <Link href={shop}>{tNav("Shop")}</Link>
            <Link href={`/${locale}/events`}>{tNav("Events")}</Link>
            <Link href={`/${locale}/reviews`}>{tNav("Reviews")}</Link>
          </nav>

          <HeaderActions
            locale={locale}
            initialSession={initialSession}
            whatsappNumber={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}
            labels={{
              cart: tNav("Cart"),
              account: tNav("Account"),
              dashboard: tNav("Dashboard"),
              signIn: tAuth("SignIn"),
              signOut: tAuth("SignOut"),
              shop: tNav("Shop"),
              events: tNav("Events"),
              reviews: tNav("Reviews"),
              menu: t("menu"),
            }}
          />
        </div>

        <ShopNavVisibility locale={locale}>
          <div className="shop-nav">
            <div className="shop-shortcuts">
              {[
                { href: shop, label: t("allProducts") },
                { href: `${shop}?sort=popular`, label: t("bestsellers") },
                { href: `${shop}?sort=mild-first`, label: t("shopByHeat") },
                {
                  href: `${shop}?category=gift-boxes-sets`,
                  label: t("giftBoxes"),
                },
                {
                  href: `${shop}?brand=our-own-range`,
                  label: t("ownSauces"),
                },
              ].map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </div>
            <form role="search" action={shop}>
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                name="q"
                aria-label={t("searchLabel")}
                placeholder={t("searchPlaceholder")}
              />
              <button type="submit" aria-label={t("searchSubmit")}>
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </form>
          </div>
        </ShopNavVisibility>
      </header>
    </>
  );
}
