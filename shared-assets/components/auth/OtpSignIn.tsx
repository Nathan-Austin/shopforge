'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { supabase } from '@/lib/supabase/client';
import { mergeGuestCartAction } from '@/lib/cart/actions';
import { authErrorKey } from '@/lib/auth/messages';

/**
 * Email + one-time code sign-in, for shops generated with customer sign-in
 * set to "otp". The customer types their email, receives a six-digit code
 * and types it back. There is no password and no link to click, which
 * matters because mail scanners (Microsoft's in particular) open links
 * before the customer does and burn them.
 *
 * Signing in and signing up are the same action here: the first code
 * creates the account. The code also confirms the address, so a guest's
 * earlier orders can be attached straight away.
 *
 * Requires the Supabase "Magic Link" email template to contain
 * {{ .Token }} rather than {{ .ConfirmationURL }}; see SETUP_GUIDE.md.
 */
export default function OtpSignIn({
  locale,
  initialEmail = '',
  next
}: {
  locale: string;
  initialEmail?: string;
  next?: string | null;
}) {
  const router = useRouter();
  const t = useTranslations('Auth');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true }
    });
    setBusy(false);
    if (error) {
      console.error('Sending the sign-in code failed:', error.code, error.message);
      setErr(t(`errors.${authErrorKey(error) ?? 'generic'}`));
      return;
    }
    setSent(true);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'email'
    });
    if (error) {
      console.error('The sign-in code was refused:', error.code, error.message);
      setBusy(false);
      setErr(t(`errors.${authErrorKey(error) ?? 'generic'}`));
      return;
    }

    // Keep anything added before signing in, and pull back a cart left on
    // another device.
    await mergeGuestCartAction(locale);
    router.push(next ?? `/${locale}`);
    router.refresh();
  }

  if (!sent) {
    return (
      <form onSubmit={sendCode} className="space-y-3">
        <input
          className="w-full border p-2 rounded"
          placeholder={t('email')}
          aria-label={t('email')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {err && <p className="text-red-600 text-sm" role="alert">{err}</p>}
        <button className="w-full rounded bg-black text-white p-2" disabled={busy}>
          {busy ? t('sending') : t('otp.send')}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verifyCode} className="space-y-3">
      <p className="text-sm text-gray-600">
        {t.rich('otp.sent', { email, strong: (chunks) => <strong>{chunks}</strong> })}
      </p>
      <input
        className="w-full border p-2 rounded tracking-widest"
        placeholder="123456"
        aria-label={t('code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6,8}"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
      />
      {err && <p className="text-red-600 text-sm" role="alert">{err}</p>}
      <button className="w-full rounded bg-black text-white p-2" disabled={busy}>
        {busy ? t('checking') : t('signIn.submit')}
      </button>
      <button
        type="button"
        className="w-full text-sm text-gray-600 underline"
        onClick={() => {
          setSent(false);
          setCode('');
          setErr(null);
        }}
      >
        {t('otp.restart')}
      </button>
    </form>
  );
}
