import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/** Templates, Subscribers, Campaigns and Settings: the email section. */
export default async function EmailTabs({
  locale,
  current
}: {
  locale: string;
  current: 'templates' | 'subscribers' | 'campaigns' | 'settings';
}) {
  const t = await getTranslations({ locale, namespace: 'Admin.email.tabs' });
  const tabs = [
    { key: 'templates' as const, href: `/${locale}/admin/email` },
    { key: 'subscribers' as const, href: `/${locale}/admin/email/subscribers` },
    { key: 'campaigns' as const, href: `/${locale}/admin/email/campaigns` },
    { key: 'settings' as const, href: `/${locale}/admin/email/settings` }
  ];
  return (
    <nav className="flex gap-2 border-b border-border text-sm" aria-label={t('label')}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? 'page' : undefined}
          className={`-mb-px border-b-2 px-3 py-2 ${tab.key === current ? 'border-emerald-700 font-semibold text-emerald-800' : 'border-transparent text-stone-600 hover:text-emerald-700'}`}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
