'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { supabase } from '@/lib/supabase/client';
import { mergeGuestCartAction } from '@/lib/cart/actions';
import { authErrorKey } from '@/lib/auth/messages';
import type { CUSTOMER_SIGN_IN_METHODS } from '@/lib/settings/schema';
import OtpSignIn from '@/components/auth/OtpSignIn';

/**
 * Signing in, the way the shop's settings say. The page reads
 * `customerSignIn` and passes it here, so changing it in the admin takes
 * effect without a rebuild; `useSearchParams` is why this is a client
 * component with a Suspense boundary above it.
 */
export default function SignInForm({
  locale,
  customerSignIn
}: {
  locale: string;
  customerSignIn: (typeof CUSTOMER_SIGN_IN_METHODS)[number];
}) {
  const searchParams = useSearchParams();
  const t = useTranslations('Auth.signIn');
  // The shop owner always has a password, so even an email-code shop keeps
  // the password form reachable at ?method=password.
  const usePassword = customerSignIn === 'password' || searchParams.get('method') === 'password';

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold mb-4">{t('title')}</h1>
      {searchParams.get('error') === 'confirmation_failed' && (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{t('confirmationFailed')}</p>
      )}
      {usePassword ? <PasswordSignIn locale={locale} /> : <OtpSignIn locale={locale} />}
      <div className="mt-4 space-y-2 text-center text-sm text-gray-500">
        {usePassword && (
          <p>
            <Link href={`/${locale}/auth/reset-password`} className="underline">
              {t('forgot')}
            </Link>
          </p>
        )}
        {customerSignIn === 'password' && (
          <p>
            <Link href={`/${locale}/auth/sign-up`} className="underline">
              {t('noAccount')}
            </Link>
          </p>
        )}
        {customerSignIn === 'otp' && (
          <p>
            {usePassword ? (
              <Link href={`/${locale}/auth/sign-in`} className="underline">
                {t('useCode')}
              </Link>
            ) : (
              <Link href={`/${locale}/auth/sign-in?method=password`} className="underline">
                {t('ownerPassword')}
              </Link>
            )}
          </p>
        )}
      </div>
    </main>
  );
}

function PasswordSignIn({ locale }: { locale: string }) {
  const router = useRouter();
  const t = useTranslations('Auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('Sign-in failed:', error.code, error.message);
      setErr(t(`errors.${authErrorKey(error) ?? 'generic'}`));
      setBusy(false);
      return;
    }

    // Keep anything added before signing in, and pull back a cart left on
    // another device.
    await mergeGuestCartAction(locale);
    router.push(`/${locale}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm">
        <span className="sr-only">{t('email')}</span>
        <input className="w-full border p-2 rounded" placeholder={t('email')} type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/>
      </label>
      <label className="block text-sm">
        <span className="sr-only">{t('password')}</span>
        <input className="w-full border p-2 rounded" placeholder={t('password')} type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/>
      </label>
      {err && <p className="text-red-600 text-sm" role="alert">{err}</p>}
      <button className="w-full rounded bg-black text-white p-2" disabled={busy}>{busy ? t('checking') : t('signIn.submit')}</button>
    </form>
  );
}
