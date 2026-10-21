"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { getMfaStatus } from "@/lib/supabase/mfa";

export default function SignInPage() {
  const { locale } = useParams() as { locale: string };
  const t = useTranslations("Auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErr(error.message);
      } else {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", data.user.id)
          .single();

        if (profile?.role === "shop_owner") {
          const mfa = await getMfaStatus(supabase);
          const dest =
            mfa.state === "needs_enrollment"
              ? `/${locale}/auth/mfa-setup`
              : mfa.state === "needs_verification"
                ? `/${locale}/auth/mfa-verify`
                : `/${locale}/admin`;
          router.push(dest);
        } else {
          router.push(`/${locale}/account`);
        }
        router.refresh();
      }
    } catch (error) {
      setErr("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-20">
      <Card className="shadow-xl border-zinc-100">
        <CardHeader className="space-y-1 pb-8">
          <CardTitle className="text-3xl font-black uppercase tracking-tight text-center">
            {t("SignIn")}
          </CardTitle>
          <p className="text-sm text-zinc-500 text-center">
            Enter your email to access your account
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
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t("Password")}</Label>
                <Link
                  href={`/${locale}/auth/reset-password`}
                  className="text-xs font-bold text-brand-red hover:underline"
                >
                  {t("ResetPassword")}?
                </Link>
              </div>
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

            {err && (
              <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm font-medium border border-red-100">
                {err}
              </div>
            )}

            <Button
              className="w-full bg-brand-red hover:bg-brand-red/90 text-white font-bold h-12 rounded-xl text-lg shadow-lg shadow-red-100 transition-all hover:scale-[1.02] active:scale-[0.98]"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : null}
              {t("SignIn")}
            </Button>

            <div className="text-center pt-4 space-y-2">
              <p className="text-sm text-zinc-500">
                Don&apos;t have an account?{" "}
                <Link
                  href={`/${locale}/auth/sign-up`}
                  className="font-bold text-brand-red hover:underline"
                >
                  {t("SignUp")}
                </Link>
              </p>
              <p className="text-xs text-zinc-400">
                Ordered from us before? Use your original email when signing up
                to restore your order history.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
