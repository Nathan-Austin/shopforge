"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Hides the header's shortcut + search row where it's redundant: the shop
 * listing has its own filters and search, and the admin isn't shopping.
 * Product pages under /shop/<slug> keep it.
 */
export default function ShopNavVisibility({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (
    pathname === `/${locale}/shop` ||
    pathname.startsWith(`/${locale}/admin`)
  ) {
    return null;
  }
  return children;
}
