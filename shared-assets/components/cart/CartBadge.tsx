import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { getCart } from '@/lib/cart/service';

/**
 * Cart link with a live item count, so it is obvious something was added.
 * A server component: it reads the cart from the cookie on every render.
 */
export default async function CartBadge({ locale }: { locale: string }) {
  const cart = await getCart();
  const count = cart.totals.itemCount;
  const t = await getTranslations({ locale, namespace: 'Cart' });

  return (
    <Link
      href={`/${locale}/cart`}
      className="relative inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
      aria-label={count > 0 ? t('badgeLabel', { count }) : t('title')}
    >
      <span aria-hidden="true">🛒</span>
      <span>{t('title')}</span>
      {count > 0 && (
        <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-black px-1.5 text-xs font-semibold text-white">
          {count}
        </span>
      )}
    </Link>
  );
}
