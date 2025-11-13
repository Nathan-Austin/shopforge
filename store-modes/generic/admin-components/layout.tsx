import type { ReactNode } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireShopOwner } from './lib/auth';

interface AdminLayoutProps {
  children: ReactNode;
  params: { locale: string };
}

const NAV_ITEMS = [
  { key: 'dashboard', path: '' },
  { key: 'products', path: '/products' },
  { key: 'newProduct', path: '/products/new' }
];

export default async function AdminLayout({ children, params: { locale } }: AdminLayoutProps) {
  await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin' });

  return (
    <div className="min-h-screen bg-roh-dust-white">
      <header className="border-b border-border bg-white">
        <div className="max-w-6xl mx-auto flex flex-col gap-4 px-4 py-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-roh-military-olive font-semibold">
              {t('title')}
            </p>
            <h1 className="text-2xl font-bold text-foreground">{t('dashboardHeading')}</h1>
          </div>
          <nav className="flex flex-wrap items-center gap-3 text-sm">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.key}
                href={`/${locale}/admin${item.path}`}
                className="rounded-full border border-border px-4 py-1.5 hover:border-roh-flag-green hover:text-roh-flag-green transition-colors"
              >
                {t(`nav.${item.key}`)}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
