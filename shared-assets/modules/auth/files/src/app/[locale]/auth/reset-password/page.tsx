"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { requestPasswordReset } from "../../actions/auth";
import { useFormGuard } from "@/components/security/useFormGuard";
import TurnstileWidget from "@/components/security/TurnstileWidget";
import { supabase } from "@/lib/supabase/client";
import { getMfaStatus } from "@/lib/supabase/mfa";

export default function ResetPasswordPage() {
  const { locale } = useParams() as { locale: string };
  const router = useRouter();

  const [step, setStep] = useState<"request" | "verify" | "mfa">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const { honeypotValue, renderedAt, honeypotFieldProps } = useFormGuard();

  async function onRequestSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    setLoading(true);

    const result = await requestPasswordReset({
      email,
      locale,
      honeypot: honeypotValue,
      renderedAt,
      turnstileToken: turnstileToken || "",
    });

    if (result.error) setErr(result.error);
    else {
      setInfo(result.info || null);
      setStep("verify");
    }
    setLoading(false);
  }

  async function onVerifySubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setInfo(null);

    if (newPassword !== confirmPassword) {
      setErr("Passwords do not match.");
      return;
    }

    setLoading(true);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "recovery",
    });

    if (verifyError) {
      setErr("Invalid or expired code. Please try again.");
      setLoading(false);
      return;
    }

    // Accounts with MFA enrolled need an AAL2 session before Supabase will
    // let them change their password — the recovery code above only gets us
    // to AAL1. If MFA is required, collect the authenticator code next and
    // apply the password change after that elevates the session.
    const mfaStatus = await getMfaStatus(supabase);
    if (mfaStatus.state === "needs_verification") {
      setFactorId(mfaStatus.factorId);
      setStep("mfa");
      setLoading(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setErr(updateError.message);
      setLoading(false);
      return;
    }

    router.push(`/${locale}/account`);
    router.refresh();
  }

  async function onMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!factorId) {
      setErr("Something went wrong. Please start over.");
      return;
    }

    setLoading(true);

    const { error: mfaError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: mfaCode,
    });

    if (mfaError) {
      setErr("Invalid authenticator code. Please try again.");
      setLoading(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setErr(updateError.message);
      setLoading(false);
      return;
    }

    router.push(`/${locale}/account`);
    router.refresh();
  }

  if (step === "mfa") {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="text-2xl font-bold mb-4">Confirm it&apos;s you</h1>
        <p className="text-sm text-zinc-600 mb-4">
          Your account has extra security enabled. Enter the code from your
          authenticator app to finish changing your password.
        </p>
        <form onSubmit={onMfaSubmit} className="space-y-3">
          <input
            className="w-full border p-2 rounded text-center text-lg tracking-widest"
            placeholder="123456"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
            required
            autoFocus
          />
          {err && <p className="text-red-600 text-sm">{err}</p>}
          <button
            className="w-full rounded bg-black text-white p-2 disabled:opacity-60"
            disabled={loading || mfaCode.length !== 6}
          >
            Confirm
          </button>
        </form>
      </main>
    );
  }

  if (step === "verify") {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="text-2xl font-bold mb-4">Enter your code</h1>
        <p className="text-sm text-zinc-600 mb-4">
          We sent a verification code to {email}. Enter it below along with
          your new password.
        </p>
        <form onSubmit={onVerifySubmit} className="space-y-3">
          <input
            className="w-full border p-2 rounded text-center text-lg tracking-widest"
            placeholder="Verification code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
            autoFocus
          />
          <input
            className="w-full border p-2 rounded"
            placeholder="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
          <input
            className="w-full border p-2 rounded"
            placeholder="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
          {err && <p className="text-red-600 text-sm">{err}</p>}
          <button
            className="w-full rounded bg-black text-white p-2 disabled:opacity-60"
            disabled={loading || code.length < 6}
          >
            Set new password
          </button>
          <button
            type="button"
            className="w-full text-sm text-zinc-500 underline"
            onClick={() => {
              setStep("request");
              setCode("");
              setNewPassword("");
              setConfirmPassword("");
              setErr(null);
              setInfo(null);
              setTurnstileToken(null);
            }}
          >
            Didn&apos;t get a code? Request a new one
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold mb-4">Reset password</h1>
      <form onSubmit={onRequestSubmit} className="space-y-3">
        <input {...honeypotFieldProps} />
        <input
          className="w-full border p-2 rounded"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <TurnstileWidget onVerify={setTurnstileToken} />
        {err && <p className="text-red-600 text-sm">{err}</p>}
        {info && <p className="text-green-700 text-sm">{info}</p>}
        <button
          className="w-full rounded bg-black text-white p-2 disabled:opacity-60"
          disabled={loading || !turnstileToken}
        >
          Send reset code
        </button>
      </form>
    </main>
  );
}
