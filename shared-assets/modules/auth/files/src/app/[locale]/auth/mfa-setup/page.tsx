"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldCheck } from "lucide-react";
import { getMfaStatus, cleanupStaleUnverifiedTotpFactors } from "@/lib/supabase/mfa";

type ViewState =
  | { kind: "loading" }
  | { kind: "enroll"; factorId: string; qrCode: string; secret: string }
  | { kind: "satisfied"; factorId: string; friendlyName: string }
  | { kind: "blocked" };

export default function MfaSetupPage() {
  const { locale } = useParams() as { locale: string };
  const router = useRouter();
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function startEnrollment() {
    setErr(null);
    await cleanupStaleUnverifiedTotpFactors(supabase);
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator app",
      issuer: "Your Store Admin",
    });

    if (error || !data || data.type !== "totp") {
      setErr(error?.message || "Failed to start MFA enrollment");
      setView({ kind: "blocked" });
      return;
    }

    setView({
      kind: "enroll",
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace(`/${locale}/auth/sign-in`);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role !== "shop_owner") {
        router.replace(`/${locale}`);
        return;
      }

      const mfa = await getMfaStatus(supabase);
      if (cancelled) return;

      if (mfa.state === "needs_verification") {
        router.replace(`/${locale}/auth/mfa-verify`);
        return;
      }

      if (mfa.state === "satisfied") {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const factor = factors?.totp?.[0];
        if (cancelled) return;
        if (factor) {
          setView({
            kind: "satisfied",
            factorId: factor.id,
            friendlyName: factor.friendly_name || "Authenticator app",
          });
          return;
        }
      }

      await startEnrollment();
    }

    init();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    if (view.kind !== "enroll") return;
    setSubmitting(true);
    setErr(null);

    try {
      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId: view.factorId });

      if (challengeError || !challenge) {
        setErr(challengeError?.message || "Failed to start verification");
        return;
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: view.factorId,
        challengeId: challenge.id,
        code,
      });

      if (verifyError) {
        setErr(verifyError.message);
        return;
      }

      router.push(`/${locale}/admin`);
      router.refresh();
    } catch {
      setErr("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  async function onReplaceDevice() {
    if (view.kind !== "satisfied") return;
    setSubmitting(true);
    setErr(null);
    try {
      const { error } = await supabase.auth.mfa.unenroll({
        factorId: view.factorId,
      });
      if (error) {
        setErr(error.message);
        return;
      }
      setView({ kind: "loading" });
      await startEnrollment();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-20">
      <Card className="shadow-xl border-zinc-100">
        <CardHeader className="space-y-1 pb-8">
          <CardTitle className="text-3xl font-black uppercase tracking-tight text-center">
            Two-Factor Authentication
          </CardTitle>
          <p className="text-sm text-zinc-500 text-center">
            {view.kind === "satisfied"
              ? "Manage the authenticator app protecting your account"
              : "Required for shop owner accounts"}
          </p>
        </CardHeader>
        <CardContent>
          {view.kind === "loading" && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-brand-red" />
            </div>
          )}

          {view.kind === "blocked" && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm font-medium border border-red-100">
                {err || "Something went wrong setting up MFA."}
              </div>
              <Button
                className="w-full bg-brand-red hover:bg-brand-red/90 text-white font-bold h-12 rounded-xl"
                onClick={startEnrollment}
              >
                Try again
              </Button>
            </div>
          )}

          {view.kind === "satisfied" && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 border border-green-100">
                <ShieldCheck className="h-6 w-6 text-green-600 shrink-0" />
                <div>
                  <p className="font-bold text-green-800">MFA is enabled</p>
                  <p className="text-sm text-green-700">
                    Device: {view.friendlyName}
                  </p>
                </div>
              </div>

              {err && (
                <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm font-medium border border-red-100">
                  {err}
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm text-zinc-500">
                  Getting a new phone? Replacing your device revokes the old
                  authenticator immediately and walks you through enrolling a
                  new one.
                </p>
                <Button
                  variant="outline"
                  className="w-full h-12 rounded-xl"
                  disabled={submitting}
                  onClick={onReplaceDevice}
                >
                  {submitting ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : null}
                  Replace this device
                </Button>
              </div>
            </div>
          )}

          {view.kind === "enroll" && (
            <form onSubmit={onSubmitCode} className="space-y-5">
              <p className="text-sm text-zinc-600">
                Scan this QR code with an authenticator app (Google
                Authenticator, Authy, 1Password, etc.), then enter the
                6-digit code it shows you.
              </p>

              <div className="flex justify-center p-4 bg-white border border-zinc-200 rounded-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={view.qrCode}
                  alt="Scan this QR code with your authenticator app"
                  className="h-48 w-48"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-zinc-500">
                  Can&apos;t scan? Enter this code manually:
                </Label>
                <code className="block w-full p-2 rounded-lg bg-zinc-50 border border-zinc-200 text-xs break-all">
                  {view.secret}
                </code>
              </div>

              <div className="space-y-2">
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  required
                  autoFocus
                  className="h-12 rounded-xl border-zinc-200 focus:ring-brand-red focus:border-brand-red text-center text-lg tracking-widest"
                  disabled={submitting}
                />
              </div>

              {err && (
                <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm font-medium border border-red-100">
                  {err}
                </div>
              )}

              <Button
                className="w-full bg-brand-red hover:bg-brand-red/90 text-white font-bold h-12 rounded-xl text-lg shadow-lg shadow-red-100 transition-all hover:scale-[1.02] active:scale-[0.98]"
                disabled={submitting || code.length !== 6}
              >
                {submitting ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : null}
                Verify and enable
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
