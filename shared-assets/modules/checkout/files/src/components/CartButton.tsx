"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";

export default function CartButton({
  locale,
  label,
  cartCount,
  iconOnly = false,
}: {
  locale: string;
  label: string;
  cartCount?: number;
  iconOnly?: boolean;
}) {
  const pathname = usePathname();
  if (pathname.includes("/admin")) return null;

  if (iconOnly) {
    return (
      <Link href={`/${locale}/cart`} className="relative p-2 text-zinc-800 hover:text-brand-red transition-colors" aria-label={label}>
        <ShoppingCart size={22} />
        {cartCount != null && cartCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-red text-[9px] font-bold text-white leading-none ring-1 ring-white">
            {cartCount > 99 ? "99+" : cartCount}
          </span>
        )}
      </Link>
    );
  }

  return (
    <Link
      href={`/${locale}/cart`}
      className="relative rounded-full bg-brand-black px-5 py-2 text-white hover:bg-brand-red transition-all"
    >
      {label}
      {cartCount != null && cartCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-red text-[10px] font-bold text-white leading-none ring-2 ring-white">
          {cartCount > 99 ? "99+" : cartCount}
        </span>
      )}
    </Link>
  );
}
