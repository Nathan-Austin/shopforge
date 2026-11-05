import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { maskEmail } from '@/lib/email/campaigns/testSendLog';
import { confirmFromLink } from '@/lib/email/subscribers/actions';
import { readSubscriberLink, type ConfirmResult } from '@/lib/email/subscribers/service';
import { NOINDEX } from '@/lib/seo/alternates';
import NewsletterNotice from '../NewsletterNotice';

export const metadata: Metadata = NOINDEX;
export const dynamic = 'force-dynamic';

const RESULTS: ConfirmResult[] = ['confirmed', 'already-subscribed', 'unsubscribed', 'invalid', 'expired', 'unavailable'];
const RESULT_KEYS: Record<ConfirmResult, string> = {
  confirmed: 'confirmed',
  'already-subscribed': 'alreadySubscribed',
  unsubscribed: 'unsubscribed',
  invalid: 'invalid',
  expired: 'expired',
  unavailable: 'unavailable'
};

/**
 * The link in the confirmation email lands here. Opening it changes
 * nothing (mail scanners open links); the button does.
 */
export default async function NewsletterConfirmPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ t?: string; status?: string }>;
}) {
  const { locale } = await params;
  const { t: token, status } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'Newsletter' });
  const shop = process.env.NEXT_PUBLIC_SHOP_NAME?.trim() || 'Our shop';
  const back = { backHref: `/${locale}`, backLabel: t('backToShop') };

  if (status && (RESULTS as string[]).includes(status)) {
    const result = status as ConfirmResult;
    return (
      <NewsletterNotice title={t('confirm.title')} tone={result === 'confirmed' || result === 'already-subscribed' ? 'good' : 'bad'} {...back}>
        <p>{t(`confirm.${RESULT_KEYS[result]}`, { shop })}</p>
      </NewsletterNotice>
    );
  }

  const link = await readSubscriberLink(token, 'confirm');
  if (!link.valid) {
    return (
      <NewsletterNotice title={t('confirm.title')} tone="bad" {...back}>
        <p>{t(`confirm.${RESULT_KEYS[link.reason]}`, { shop })}</p>
      </NewsletterNotice>
    );
  }
  if (link.status !== 'pending') {
    return (
      <NewsletterNotice title={t('confirm.title')} tone={link.status === 'subscribed' ? 'good' : 'bad'} {...back}>
        <p>{t(link.status === 'subscribed' ? 'confirm.alreadySubscribed' : 'confirm.unsubscribed', { shop })}</p>
      </NewsletterNotice>
    );
  }
  return (
    <NewsletterNotice title={t('confirm.title')} {...back}>
      <p>{t('confirm.body', { shop, email: maskEmail(link.email) ?? '' })}</p>
      <form action={confirmFromLink.bind(null, locale)}>
        <input type="hidden" name="t" value={token} />
        <button type="submit" className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700">
          {t('confirm.button')}
        </button>
      </form>
    </NewsletterNotice>
  );
}
