"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { signUp } from "../../actions/auth";
import { useFormGuard } from "@/components/security/useFormGuard";
import TurnstileWidget from "@/components/security/TurnstileWidget";
import { supabase } from "@/lib/supabase/client";

export default function SignUpPage() {
  const { locale } = useParams() as { locale: string };
  const t = useTranslations("Auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "verify">("form");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const { honeypotValue, renderedAt, honeypotFieldProps } = useFormGuard();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);

    if (password !== confirm) {
      setErr("Passwords do not match"); // I should ideally add this to messages too
      setLoading(false);
      return;
    }

    try {
      const result = await signUp({
        email,
        password,
        honeypot: honeypotValue,
        renderedAt,
        turnstileToken: turnstileToken || "",
      });

      if (result.error) {
        setErr(result.error);
      } else {
        setStep("verify");
      }
    } catch (error) {
      setErr("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function onVerifySubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "signup",
    });

    if (error) {
      setErr("Invalid or expired code. Please try again.");
      setLoading(false);
      return;
    }

    router.push(`/${locale}/account`);
    router.refresh();
  }

  if (step === "verify") {
    return (
      <main className="mx-auto max-w-md px-4 py-20">
        <Card className="shadow-xl border-zinc-100">
          <CardHeader className="space-y-1 pb-8">
            <CardTitle className="text-3xl font-black uppercase tracking-tight text-center">
              Check your email
            </CardTitle>
            <p className="text-sm text-zinc-500 text-center">
              We&apos;ve sent a verification code to <strong>{email}</strong>.
              Enter it below to activate your account.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onVerifySubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={10}
                  placeholder="Verification code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  required
                  autoFocus
                  className="h-12 rounded-xl border-zinc-200 focus:ring-brand-red focus:border-brand-red text-center text-lg tracking-widest"
                  disabled={loading}
                />
              </div>

              {err && (
                <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm font-medium border border-red-100">
                  {err}
                </div>
              )}

              <Button
                className="w-full bg-brand-red hover:bg-brand-red/90 text-white font-bold h-12 rounded-xl text-lg shadow-lg shadow-red-100 transition-all hover:scale-[1.02] active:scale-[0.98]"
                disabled={loading || code.length < 6}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : null}
                Confirm account
              </Button>

              <button
                type="button"
                className="w-full text-sm text-zinc-500 underline"
                onClick={() => {
                  setStep("form");
                  setCode("");
                  setErr(null);
                }}
              >
                Didn&apos;t get a code? Go back
              </button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-20">
      <Card className="shadow-xl border-zinc-100">
        <CardHeader className="space-y-1 pb-8">
          <CardTitle className="text-3xl font-black uppercase tracking-tight text-center">
            {t("SignUp")}
          </CardTitle>
          <p className="text-sm text-zinc-500 text-center">
            Create an account to track your orders
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">{t("Email")}</Label>
              <Input
                id="email"
                placeholder="you@example.com"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12 rounded-xl border-zinc-200 focus:ring-brand-red focus:border-brand-red"
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("Password")}</Label>
              <Input
                id="password"
                placeholder="••••••••"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-12 rounded-xl border-zinc-200 focus:ring-brand-red focus:border-brand-red"
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">{t("ConfirmPassword")}</Label>
              <Input
                id="confirm"
                placeholder="••••••••"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="h-12 rounded-xl border-zinc-200 focus:ring-brand-red focus:border-brand-red"
                disabled={loading}
              />
            </div>

            <input {...honeypotFieldProps} />
            <TurnstileWidget onVerify={setTurnstileToken} />

            {err && (
              <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm font-medium border border-red-100">
                {err}
              </div>
            )}

            <Button
              className="w-full bg-brand-red hover:bg-brand-red/90 text-white font-bold h-12 rounded-xl text-lg shadow-lg shadow-red-100 transition-all hover:scale-[1.02] active:scale-[0.98]"
              disabled={loading || !turnstileToken}
            >
              {loading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : null}
              {t("SignUp")}
            </Button>

            <div className="text-center pt-4">
              <p className="text-sm text-zinc-500">
                Already have an account?{" "}
                <Link
                  href={`/${locale}/auth/sign-in`}
                  className="font-bold text-brand-red hover:underline"
                >
                  {t("SignIn")}
                </Link>
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
