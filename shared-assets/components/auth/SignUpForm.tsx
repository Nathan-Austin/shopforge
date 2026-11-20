'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { supabase } from '@/lib/supabase/client';
import { authErrorKey, safeNextPath } from '@/lib/auth/messages';
import type { CUSTOMER_SIGN_IN_METHODS } from '@/lib/settings/schema';
import OtpSignIn from '@/components/auth/OtpSignIn';

/**
 * Creating an account. With email codes there is no separate sign-up, so
 * this page offers the code form instead; the page above reads which it
 * is from the shop's settings.
 */
export default function SignUpForm({
  locale,
  customerSignIn
}: {
  locale: string;
  customerSignIn: (typeof CUSTOMER_SIGN_IN_METHODS)[number];
}) {
  const searchParams = useSearchParams();
  const t = useTranslations('Auth');
  // Where to land after the confirmation link. The success page sends
  // guests here with their checkout email and itself as `next`, so that
  // confirming the account brings them straight back to their order.
  // Same-site paths only: never redirect through a link to somewhere else.
  const requestedNext = searchParams.get('next');
  const next = requestedNext ? safeNextPath(requestedNext, '') || null : null;

  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // With email codes the first code creates the account and confirms the
  // address in one step.
  if (customerSignIn === 'otp') {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="text-2xl font-bold mb-4">{t('signUp.title')}</h1>
        <OtpSignIn locale={locale} initialEmail={email} next={next} />
      </main>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr(t('errors.passwordsDiffer'));
      return;
    }
    setBusy(true);
    const landing = next ?? `/${locale}`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(landing)}`
      },
    });
    setBusy(false);
    if (error) {
      console.error('Sign-up failed:', error.code, error.message);
      setErr(t(`errors.${authErrorKey(error) ?? 'generic'}`));
    } else setDone(true);
  }

  if (done) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="text-2xl font-bold mb-2">{t('signUp.checkEmailTitle')}</h1>
        <p className="text-gray-600">
          {t.rich('signUp.checkEmail', { email, strong: (chunks) => <strong>{chunks}</strong> })}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold mb-4">{t('signUp.title')}</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block text-sm">
          <span className="sr-only">{t('email')}</span>
          <input className="w-full border p-2 rounded" placeholder={t('email')} type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/>
        </label>
        <label className="block text-sm">
          <span className="sr-only">{t('password')}</span>
          <input className="w-full border p-2 rounded" placeholder={t('password')} type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required/>
        </label>
        <label className="block text-sm">
          <span className="sr-only">{t('confirmPassword')}</span>
          <input className="w-full border p-2 rounded" placeholder={t('confirmPassword')} type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required/>
        </label>
        {err && <p className="text-red-600 text-sm" role="alert">{err}</p>}
        <button className="w-full rounded bg-black text-white p-2" disabled={busy}>{busy ? t('checking') : t('signUp.submit')}</button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-500">
        <Link href={`/${locale}/auth/sign-in`} className="underline">
          {t('signUp.haveAccount')}
        </Link>
      </p>
    </main>
  );
}
