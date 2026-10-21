"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { X, Mail, Sparkles, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { subscribeToNewsletter } from "@/app/[locale]/actions/newsletter";
import { useFormGuard } from "@/components/security/useFormGuard";

export default function NewsletterPopup({ locale }: { locale: string }) {
  const t = useTranslations("Newsletter");
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { honeypotValue, renderedAt, honeypotFieldProps } = useFormGuard();

  useEffect(() => {
    // Show after 30 seconds
    const timer = setTimeout(() => {
      const dismissedUntil = localStorage.getItem("newsletter_dismissed_until");
      const hasSignedUp = document.cookie.includes("newsletter_signed_up=true");
      const consentRaw = localStorage.getItem("cookie_consent");
      const consent = consentRaw ? JSON.parse(consentRaw) : null;

      const isDismissed =
        dismissedUntil && parseInt(dismissedUntil) > Date.now();

      // Only show if:
      // 1. Not dismissed
      // 2. Not already signed up
      // 3. Either consent is not yet set (we assume we can ask) OR functional cookies are allowed
      if (!isDismissed && !hasSignedUp && (!consent || consent.functional)) {
        setIsOpen(true);
      }
    }, 30000);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setIsOpen(false);
    // Remember dismissal for 30 days
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    localStorage.setItem("newsletter_dismissed_until", expiry.toString());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPending(true);
    setError(null);

    try {
      const result = await subscribeToNewsletter({
        email,
        locale,
        honeypot: honeypotValue,
        renderedAt,
      });
      if (result.success) {
        setIsSuccess(true);
        // Set cookie to remember signup for 1 year
        document.cookie = `newsletter_signed_up=true; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
        const expiry = Date.now() + 365 * 24 * 60 * 60 * 1000;
        localStorage.setItem("newsletter_dismissed_until", expiry.toString());
        // Close after 3 seconds on success
        setTimeout(() => setIsOpen(false), 3000);
      } else {
        setError(result.error || "Failed to subscribe");
      }
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in slide-in-from-bottom-4 duration-500">
        {/* Close Button */}
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 p-1 rounded-full hover:bg-zinc-100 text-zinc-400 transition-colors"
        >
          <X size={20} />
        </button>

        <div className="p-8 md:p-10">
          {!isSuccess ? (
            <>
              <div className="flex justify-center mb-6">
                <div className="bg-red-50 p-4 rounded-full text-red-600">
                  <Sparkles size={32} />
                </div>
              </div>

              <h2 className="text-2xl font-bold text-center mb-2">
                {t("title")}
              </h2>
              <p className="text-zinc-600 text-center mb-8">
                {t("description")}
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <input {...honeypotFieldProps} />
                <div className="relative">
                  <Mail
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                    size={18}
                  />
                  <Input
                    type="email"
                    placeholder={t("placeholder")}
                    className="pl-10 h-12 rounded-xl"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isPending}
                  />
                </div>

                {error && (
                  <p className="text-red-500 text-xs text-center font-medium">
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={isPending}
                  className="w-full h-12 text-lg font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-lg shadow-red-200"
                >
                  {isPending ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : null}
                  {t("cta")}
                </Button>
              </form>

              <p className="text-[10px] text-zinc-400 text-center mt-6 uppercase tracking-wider font-semibold">
                {t("noSpam")}
              </p>
            </>
          ) : (
            <div className="text-center py-10 animate-in fade-in zoom-in">
              <div className="flex justify-center mb-6">
                <CheckCircle2 className="w-16 h-16 text-green-500" />
              </div>
              <h2 className="text-2xl font-bold mb-4">{t("successTitle")}</h2>
              <p className="text-zinc-600 mb-2">{t("successDescription")}</p>
              <p className="text-sm font-bold text-red-600">
                {t("successAction")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
