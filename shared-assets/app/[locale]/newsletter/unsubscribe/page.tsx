import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { maskEmail } from '@/lib/email/campaigns/testSendLog';
import { unsubscribeFromLink } from '@/lib/email/subscribers/actions';
import { readSubscriberLink } from '@/lib/email/subscribers/service';
import { NOINDEX } from '@/lib/seo/alternates';
import NewsletterNotice from '../NewsletterNotice';

export const metadata: Metadata = NOINDEX;
export const dynamic = 'force-dynamic';

/**
 * The unsubscribe link in every campaign lands here. Like the confirm
 * page, opening it changes nothing; the button does. (Mail clients'
 * own one-click button posts to /api/email/unsubscribe instead.)
 */
export default async function NewsletterUnsubscribePage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ t?: string; status?: string; preview?: string }>;
}) {
  const { locale } = await params;
  const { t: token, status, preview } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'Newsletter' });
  const shop = process.env.NEXT_PUBLIC_SHOP_NAME?.trim() || 'Our shop';
  const back = { backHref: `/${locale}`, backLabel: t('backToShop') };
  const button = 'rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700';

  if (preview) {
    return (
      <NewsletterNotice title={t('unsubscribe.title')} {...back}>
        <p>{t('unsubscribe.preview')}</p>
        <button type="button" disabled className={`${button} opacity-50`}>
          {t('unsubscribe.button')}
        </button>
      </NewsletterNotice>
    );
  }

  if (status === 'unsubscribed') {
    return (
      <NewsletterNotice title={t('unsubscribe.title')} tone="good" {...back}>
        <p>{t('unsubscribe.done', { shop })}</p>
        <p className="text-sm text-gray-600">{t('unsubscribe.changedMind')}</p>
      </NewsletterNotice>
    );
  }

  const link = status === 'invalid' || status === 'unavailable' ? null : await readSubscriberLink(token, 'unsubscribe');
  if (!link || !link.valid) {
    const reason = link && !link.valid ? link.reason : status;
    return (
      <NewsletterNotice title={t('unsubscribe.title')} tone="bad" {...back}>
        <p>{t(reason === 'unavailable' ? 'unsubscribe.unavailable' : 'unsubscribe.invalid')}</p>
      </NewsletterNotice>
    );
  }
  if (link.status === 'unsubscribed') {
    return (
      <NewsletterNotice title={t('unsubscribe.title')} tone="good" {...back}>
        <p>{t('unsubscribe.alreadyDone')}</p>
      </NewsletterNotice>
    );
  }
  return (
    <NewsletterNotice title={t('unsubscribe.title')} {...back}>
      <p>{t('unsubscribe.body', { shop, email: maskEmail(link.email) ?? '' })}</p>
      <form action={unsubscribeFromLink.bind(null, locale)}>
        <input type="hidden" name="t" value={token} />
        <button type="submit" className={button}>
          {t('unsubscribe.button')}
        </button>
      </form>
    </NewsletterNotice>
  );
}
