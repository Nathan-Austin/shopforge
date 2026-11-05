'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { DEFAULT_LOCALE, LOCALES } from '@/i18n/config';
import { confirmSubscription, requestSubscription, unsubscribeByToken } from './service';

export type NewsletterFormState = { ok: true } | { ok: false; error: 'invalid-email' | 'unavailable' | 'failed' } | null;

function shopLocale(locale: string): string {
  return (LOCALES as readonly string[]).includes(locale) ? locale : DEFAULT_LOCALE;
}

/** The footer form. A filled-in `website` field is a bot: it is told "thanks" and nothing happens. */
export async function subscribeToNewsletter(locale: string, _previous: NewsletterFormState, formData: FormData): Promise<NewsletterFormState> {
  if (formData.get('website')) return { ok: true };
  const language = shopLocale(locale);
  const t = await getTranslations({ locale: language, namespace: 'Newsletter' });
  const shop = process.env.NEXT_PUBLIC_SHOP_NAME?.trim() || 'Our shop';
  const result = await requestSubscription({
    email: formData.get('email'),
    firstName: formData.get('firstName'),
    locale: language,
    source: 'footer',
    consentText: t('consent', { shop })
  });
  return result.ok ? { ok: true } : { ok: false, error: result.reason };
}

/** The confirm page's button. */
export async function confirmFromLink(locale: string, formData: FormData): Promise<never> {
  const result = await confirmSubscription(formData.get('t'));
  redirect(`/${shopLocale(locale)}/newsletter/confirm?status=${result}`);
}

/** The unsubscribe page's button. */
export async function unsubscribeFromLink(locale: string, formData: FormData): Promise<never> {
  const result = await unsubscribeByToken(formData.get('t'), 'page');
  redirect(`/${shopLocale(locale)}/newsletter/unsubscribe?status=${result}`);
}
