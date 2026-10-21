"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ShoppingBag, UserRound } from "lucide-react";
import MobileMenu from "./MobileMenu";
import LocaleSwitcher from "./store/LocaleSwitcher";

interface SessionData {
  isLoggedIn: boolean;
  isShopOwner: boolean;
  cartCount: number;
}

interface HeaderActionsProps {
  locale: string;
  initialSession?: { isLoggedIn: boolean; isShopOwner: boolean };
  whatsappNumber?: string;
  labels: {
    cart: string;
    account: string;
    dashboard: string;
    signIn: string;
    signOut: string;
    shop: string;
    events: string;
    reviews: string;
    menu: string;
  };
}

export default function HeaderActions({
  locale,
  initialSession,
  whatsappNumber,
  labels,
}: HeaderActionsProps) {
  const [session, setSession] = useState<SessionData>({
    isLoggedIn: initialSession?.isLoggedIn ?? false,
    isShopOwner: initialSession?.isShopOwner ?? false,
    cartCount: 0,
  });
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  const pathname = usePathname();

  const fetchSession = () => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((data) => setSession(data))
      .catch(() => {});
  };

  useEffect(() => {
    fetchSession();
    window.addEventListener("cart:updated", fetchSession);
    return () => window.removeEventListener("cart:updated", fetchSession);
  }, [pathname]); // re-fetch on every route change (catches sign-in / sign-out redirects)

  useEffect(() => {
    if (!accountOpen) return;
    const close = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [accountOpen]);

  const { isLoggedIn, isShopOwner, cartCount } = session;
  const accountHref = isShopOwner ? `/${locale}/admin` : `/${locale}/account`;
  const accountLabel = isShopOwner ? labels.dashboard : labels.account;

  return (
    <div className="header-actions">
      <span className="language">
        <LocaleSwitcher variant="compact" />
      </span>

      {isLoggedIn ? (
        <div className="account-menu" ref={accountRef}>
          <button
            type="button"
            aria-label={accountLabel}
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen(!accountOpen)}
          >
            <UserRound size={21} aria-hidden="true" />
          </button>
          {accountOpen && (
            <div className="account-dropdown">
              <Link href={accountHref} onClick={() => setAccountOpen(false)}>
                {accountLabel}
              </Link>
              <form action="/api/auth/sign-out" method="POST">
                <button type="submit">{labels.signOut}</button>
              </form>
            </div>
          )}
        </div>
      ) : (
        <Link href={`/${locale}/auth/sign-in`} aria-label={labels.signIn}>
          <UserRound size={21} aria-hidden="true" />
        </Link>
      )}

      {!pathname.includes("/admin") && (
        <Link
          href={`/${locale}/cart`}
          className="basket-button"
          aria-label={`${labels.cart}, ${cartCount}`}
        >
          <ShoppingBag size={21} aria-hidden="true" />
          <span>{cartCount > 99 ? "99+" : cartCount}</span>
        </Link>
      )}

      <span className="mobile-menu">
        <MobileMenu
          locale={locale}
          isLoggedIn={isLoggedIn}
          isShopOwner={isShopOwner}
          whatsappNumber={whatsappNumber}
          labels={labels}
        />
      </span>
    </div>
  );
}
