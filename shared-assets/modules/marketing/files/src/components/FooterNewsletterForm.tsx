"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Loader2 } from "lucide-react";
import { subscribeToNewsletter } from "@/app/[locale]/actions/newsletter";
import { useFormGuard } from "@/components/security/useFormGuard";

export default function FooterNewsletterForm({
  locale,
  initialSubscribed = false,
}: {
  locale: string;
  initialSubscribed?: boolean;
}) {
  const t = useTranslations("Newsletter");
  const [email, setEmail] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(initialSubscribed);
  const [justSubscribed, setJustSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { honeypotValue, renderedAt, honeypotFieldProps } = useFormGuard();

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
        setJustSubscribed(true);
        document.cookie = `newsletter_signed_up=true; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
        setEmail("");
      } else {
        setError(result.error || "Failed to subscribe");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  if (isSuccess) {
    return (
      <p className="newsletter-done" role="status">
        {justSubscribed
          ? t("successDescription")
          : t("alreadySubscribed") || "You're already on our mailing list!"}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <input {...honeypotFieldProps} />
      <label htmlFor="newsletter-email">{t("emailLabel")}</label>
      <div>
        <input
          id="newsletter-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={isPending}
        />
        <button type="submit" disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <>
              {t("cta")}
              <ArrowRight size={15} aria-hidden="true" />
            </>
          )}
        </button>
      </div>
      {error ? (
        <p role="alert" className="newsletter-error">{error}</p>
      ) : (
        <p>{t("noSpam")}</p>
      )}
    </form>
  );
}
