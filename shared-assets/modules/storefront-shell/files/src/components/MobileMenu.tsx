"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Instagram, MessageCircle } from "lucide-react";
import LocaleSwitcher from "./store/LocaleSwitcher";

interface MobileMenuProps {
  locale: string;
  isLoggedIn: boolean;
  isShopOwner: boolean;
  whatsappNumber?: string;
  labels: {
    shop: string;
    events: string;
    reviews: string;
    account: string;
    dashboard: string;
    signIn: string;
    signOut: string;
    menu?: string;
  };
}

export default function MobileMenu({
  locale,
  isLoggedIn,
  isShopOwner,
  whatsappNumber,
  labels,
}: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAnimatedIn, setIsAnimatedIn] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  const navLinks = [
    { href: `/${locale}/shop`, label: labels.shop },
    { href: `/${locale}/events`, label: labels.events },
    { href: `/${locale}/reviews`, label: labels.reviews },
  ];

  // Trigger slide-in on the frame after the drawer mounts
  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => setIsAnimatedIn(true));
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  // Close immediately on navigation (page transition is the visual feedback)
  useEffect(() => {
    setIsOpen(false);
    setIsAnimatedIn(false);
    setIsClosing(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, [pathname]);

  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  // Cleanup timer on unmount
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const openMenu = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setIsClosing(false);
    setIsAnimatedIn(false);
    setIsOpen(true);
  };

  const closeMenu = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setIsClosing(true);
    setIsAnimatedIn(false);
    closeTimer.current = setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
      closeTimer.current = null;
    }, 300);
  };

  const translated = isOpen && isAnimatedIn && !isClosing;

  return (
    <>
      {/* Trigger — icon + label for a clear, easy tap target */}
      <button
        onClick={openMenu}
        className="flex items-center p-1 text-zinc-800 hover:text-brand-red transition-colors"
        aria-label={labels.menu ?? "Open menu"}
        aria-expanded={isOpen}
        aria-controls="mobile-drawer"
      >
        <Menu size={22} aria-hidden="true" />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${translated ? "opacity-100" : "opacity-0"}`}
            onClick={closeMenu}
            aria-hidden="true"
          />

          {/* Full-screen drawer */}
          <div
            id="mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className={`fixed inset-0 z-50 flex flex-col bg-white transition-transform duration-300 ease-in-out pt-[env(safe-area-inset-top)] ${translated ? "translate-x-0" : "translate-x-full"}`}
            style={{ height: "100dvh" }}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100">
              <span className="text-sm font-bold uppercase tracking-widest text-zinc-400">
                Menu
              </span>
              <button
                onClick={closeMenu}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-zinc-100 text-zinc-800 hover:bg-brand-red hover:text-white transition-all font-bold text-sm"
                aria-label="Close menu"
              >
                <X size={16} />
                Close
              </button>
            </div>

            {/* Nav links */}
            <nav className="flex-1 overflow-y-auto px-6 py-4 flex flex-col">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={closeMenu}
                  className={`py-4 text-xl font-bold uppercase tracking-widest border-b border-zinc-100 transition-colors ${
                    pathname.startsWith(link.href)
                      ? "text-brand-red"
                      : "text-zinc-800 hover:text-brand-red"
                  }`}
                >
                  {link.label}
                </Link>
              ))}

              {/* Auth links */}
              <div className="mt-6 pt-2 flex flex-col">
                {isLoggedIn ? (
                  <>
                    <Link
                      href={isShopOwner ? `/${locale}/admin` : `/${locale}/account`}
                      onClick={closeMenu}
                      className="py-4 text-base font-semibold text-zinc-700 hover:text-brand-red transition-colors border-b border-zinc-100"
                    >
                      {isShopOwner ? labels.dashboard : labels.account}
                    </Link>
                    <form action="/api/auth/sign-out" method="POST">
                      <button
                        type="submit"
                        className="py-4 w-full text-left text-base font-semibold text-zinc-400 hover:text-brand-red transition-colors"
                      >
                        {labels.signOut}
                      </button>
                    </form>
                  </>
                ) : (
                  <Link
                    href={`/${locale}/auth/sign-in`}
                    onClick={closeMenu}
                    className="py-4 text-base font-semibold text-zinc-700 hover:text-brand-red transition-colors"
                  >
                    {labels.signIn}
                  </Link>
                )}
              </div>
            </nav>

            {/* Footer: locale switcher + socials */}
            <div
              className="px-6 py-5 border-t border-zinc-100 flex items-center justify-between"
              style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
            >
              <LocaleSwitcher dropup align="left" />
              <div className="flex items-center gap-1">
                <a
                  href="https://www.instagram.com/example.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2.5 transition-colors"
                  style={{ color: "#E1306C" }}
                  aria-label="Instagram"
                >
                  <Instagram size={22} />
                </a>
                {whatsappNumber && (
                  <a
                    href={`https://wa.me/${whatsappNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2.5 transition-colors"
                    style={{ color: "#25D366" }}
                    aria-label="WhatsApp"
                  >
                    <MessageCircle size={22} />
                  </a>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
