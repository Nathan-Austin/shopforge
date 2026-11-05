'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import type { NewsletterFormState } from '@/lib/email/subscribers/actions';

interface NewsletterSignupProps {
  action: (previous: NewsletterFormState, formData: FormData) => Promise<NewsletterFormState>;
  shopName: string;
}

/**
 * Email (and, if they like, a first name) for the newsletter. Submitting
 * is the request; the confirmation email is the consent. The hidden
 * `website` field catches form-filling bots.
 */
export default function NewsletterSignup({ action, shopName }: NewsletterSignupProps) {
  const t = useTranslations('Newsletter');
  const [state, formAction, pending] = useActionState(action, null);
  const input = 'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900';

  if (state?.ok) {
    return (
      <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        {t('thanks')}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">{t('heading')}</h2>
        <p className="text-sm text-gray-600">{t('intro', { shop: shopName })}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
        <label className="block text-sm">
          <span className="sr-only">{t('email')}</span>
          <input type="email" name="email" required autoComplete="email" placeholder={t('email')} className={input} />
        </label>
        <label className="block text-sm">
          <span className="sr-only">{t('firstName')}</span>
          <input type="text" name="firstName" maxLength={100} autoComplete="given-name" placeholder={t('firstName')} className={input} />
        </label>
        <button type="submit" disabled={pending} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-60">
          {pending ? t('sending') : t('submit')}
        </button>
      </div>
      {/* Hidden from people, not from bots. Clipped in place rather than moved
          off-screen: pushed far left, it made right-to-left pages scroll sideways. */}
      <div aria-hidden="true" className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0 [clip:rect(0,0,0,0)]">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <p className="text-xs text-gray-500">{t('consent', { shop: shopName })}</p>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-red-700">
          {state.error === 'invalid-email' ? t('invalidEmail') : t('failed')}
        </p>
      )}
    </form>
  );
}
