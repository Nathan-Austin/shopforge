"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { getMfaStatus } from "@/lib/supabase/mfa";

export default function MfaVerifyPage() {
  const { locale } = useParams() as { locale: string };
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

      if (mfa.state === "needs_enrollment") {
        router.replace(`/${locale}/auth/mfa-setup`);
        return;
      }

      if (mfa.state === "satisfied") {
        router.replace(`/${locale}/admin`);
        return;
      }

      setFactorId(mfa.factorId);
      setReady(true);
    }

    init();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setSubmitting(true);
    setErr(null);

    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });

      if (error) {
        setErr(error.message);
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

  return (
    <main className="mx-auto max-w-md px-4 py-20">
      <Card className="shadow-xl border-zinc-100">
        <CardHeader className="space-y-1 pb-8">
          <CardTitle className="text-3xl font-black uppercase tracking-tight text-center">
            Verify It&apos;s You
          </CardTitle>
          <p className="text-sm text-zinc-500 text-center">
            Enter the 6-digit code from your authenticator app
          </p>
        </CardHeader>
        <CardContent>
          {!ready ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-brand-red" />
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5">
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
                Verify
              </Button>

              <p className="text-xs text-zinc-400 text-center pt-2">
                Lost your authenticator device? Contact support to regain
                access.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
