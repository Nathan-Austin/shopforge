import { getTranslations } from 'next-intl/server';

import { subscribeToNewsletter } from '@/lib/email/subscribers/actions';
import { resolveNewsletterStatus } from '@/lib/email/subscribers/config';
import NewsletterSignup from './NewsletterSignup';

/**
 * The bottom of every page: the newsletter sign-up, when the shop can
 * send its confirmation emails, and the copyright line.
 */
export default async function SiteFooter({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'Footer' });
  const shopName = process.env.NEXT_PUBLIC_SHOP_NAME?.trim() || 'Our shop';
  const newsletter = (await resolveNewsletterStatus()).enabled;

  return (
    <footer className="mt-16 border-t border-gray-200 bg-gray-50">
      {/* Same width as the header, so the two line up. */}
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        {newsletter && (
          <div className="max-w-2xl">
            <NewsletterSignup action={subscribeToNewsletter.bind(null, locale)} shopName={shopName} />
          </div>
        )}
        <p className="text-xs text-gray-500">{t('copyright', { year: new Date().getFullYear(), shop: shopName })}</p>
      </div>
    </footer>
  );
}
