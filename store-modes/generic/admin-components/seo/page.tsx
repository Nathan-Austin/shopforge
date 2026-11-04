import { getTranslations } from 'next-intl/server';

import { DEFAULT_LOCALE, LOCALES } from '@/i18n/config';
import { hreflangOf } from '@/lib/i18n/locales';
import { localizedUrl, siteUrl } from '@/lib/seo/alternates';
import { googleSiteVerification } from '@/lib/seo/store';
import { requireShopOwner } from '../lib/auth';

export const dynamic = 'force-dynamic';

/**
 * What to paste where: the sitemap URL for Search Console, one feed URL
 * per locale for Merchant Center, the verification state, and the
 * checklist. The page does not call Google; it tells the owner what the
 * shop already exposes.
 */
export default async function AdminSeoPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin.seo' });
  const base = siteUrl();
  const verified = Boolean(googleSiteVerification());

  const code = 'rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs break-all';

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold">{t('heading')}</h2>
        <p className="text-sm text-stone-600">{t('subheading')}</p>
      </div>

      <section className="space-y-2">
        <h3 className="font-semibold">{t('siteUrl')}</h3>
        <p><code className={code}>{base}</code></p>
        <p className="text-sm text-stone-600">{t('siteUrlHint')}</p>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">{t('verification')}</h3>
        <p className={`text-sm ${verified ? 'text-emerald-700' : 'text-amber-700'}`}>
          {verified ? t('verified') : t('notVerified')}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">{t('sitemap')}</h3>
        <p><a href={`${base}/sitemap.xml`} className={`${code} underline`} target="_blank" rel="noreferrer">{base}/sitemap.xml</a></p>
        <p className="text-sm text-stone-600">{t('sitemapHint')}</p>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">{t('feeds')}</h3>
        <ul className="space-y-1 text-sm">
          {LOCALES.map((code) => (
            <li key={code}>
              <span className="me-2 text-stone-600">{t('feedFor', { locale: hreflangOf(code) })}:</span>
              <a href={`${base}/api/feeds/google/${code}.xml`} className="font-mono underline break-all" target="_blank" rel="noreferrer">
                {base}/api/feeds/google/{code}.xml
              </a>
            </li>
          ))}
        </ul>
        <p className="text-sm text-stone-600">{t('feedsHint')}</p>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">{t('locales')}</h3>
        <ul className="text-sm">
          {LOCALES.map((code) => (
            <li key={code}>
              <span className="font-mono">{hreflangOf(code)}</span>
              {code === DEFAULT_LOCALE ? ' (x-default)' : ''}
              <span className="text-stone-500"> · {localizedUrl(code, '')}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-stone-600">{t('localesHint')}</p>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">{t('checklist')}</h3>
        <ol className="list-decimal space-y-1 ps-5 text-sm">
          {(['verify', 'sitemap', 'feeds', 'identifiers', 'shipping', 'currency'] as const).map((step) => (
            <li key={step}>{t(`steps.${step}`)}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
