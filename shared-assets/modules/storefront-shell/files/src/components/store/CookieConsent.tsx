"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Shield, Settings, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CookiePreferences = {
  necessary: boolean;
  functional: boolean;
  marketing: boolean;
};

export default function CookieConsent() {
  const t = useTranslations("CookieConsent");
  const [isVisible, setIsOpen] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [preferences, setPreferences] = useState<CookiePreferences>({
    necessary: true,
    functional: true,
    marketing: false,
  });

  function updateGoogleConsent(prefs: CookiePreferences) {
    if (
      typeof window !== "undefined" &&
      typeof (window as any).gtag === "function"
    ) {
      (window as any).gtag("consent", "update", {
        ad_storage: prefs.marketing ? "granted" : "denied",
        ad_user_data: prefs.marketing ? "granted" : "denied",
        ad_personalization: prefs.marketing ? "granted" : "denied",
        analytics_storage: prefs.marketing ? "granted" : "denied",
      });
    }
  }

  useEffect(() => {
    const consent = localStorage.getItem("cookie_consent");
    if (!consent) {
      // Delay opening to avoid cascading render lint error if possible,
      // though this is often a false positive for visibility toggles
      const timer = setTimeout(() => setIsOpen(true), 100);
      return () => clearTimeout(timer);
    } else {
      try {
        const prefs = JSON.parse(consent);
        updateGoogleConsent(prefs);
      } catch (e) {
        console.error("Failed to parse cookie consent", e);
      }
    }
  }, []);

  const handleAcceptAll = () => {
    const allAccepted = { necessary: true, functional: true, marketing: true };
    savePreferences(allAccepted);
  };

  const handleRejectAll = () => {
    const onlyNecessary = {
      necessary: true,
      functional: false,
      marketing: false,
    };
    savePreferences(onlyNecessary);
  };

  const savePreferences = (prefs: CookiePreferences) => {
    localStorage.setItem("cookie_consent", JSON.stringify(prefs));
    // Update Google Consent Mode
    updateGoogleConsent(prefs);

    // Also set as actual cookie for server-side if needed
    document.cookie = `cookie_consent=${JSON.stringify(prefs)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    setIsOpen(false);

    // Dispatch custom event for other components to react
    window.dispatchEvent(
      new CustomEvent("cookie_consent_updated", { detail: prefs }),
    );
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[110] p-4 md:p-6 flex justify-center animate-in slide-in-from-bottom-full duration-500">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-[0_0_50px_-12px_rgba(0,0,0,0.25)] border border-zinc-100 overflow-hidden">
        <div className="p-6 md:p-8">
          {!showCustomize ? (
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="bg-zinc-100 p-4 rounded-full text-zinc-600 hidden md:block">
                <Shield size={32} />
              </div>
              <div className="flex-grow text-center md:text-left">
                <h2 className="text-xl font-bold mb-2">{t("title")}</h2>
                <p className="text-zinc-600 text-sm leading-relaxed max-w-2xl">
                  {t("description")}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                <Button
                  variant="outline"
                  onClick={() => setShowCustomize(true)}
                  className="rounded-xl border-zinc-200"
                >
                  {t("customize")}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleRejectAll}
                  className="rounded-xl border-zinc-200"
                >
                  {t("rejectAll")}
                </Button>
                <Button
                  onClick={handleAcceptAll}
                  className="bg-black text-white hover:bg-zinc-800 rounded-xl px-8"
                >
                  {t("acceptAll")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  {t("customize")}
                </h2>
                <button
                  onClick={() => setShowCustomize(false)}
                  className="text-zinc-400 hover:text-zinc-600"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="grid gap-4">
                {/* Necessary */}
                <div className="flex items-start gap-4 p-4 rounded-xl border bg-zinc-50/50">
                  <div className="mt-1">
                    <div className="w-5 h-5 bg-zinc-200 rounded flex items-center justify-center text-zinc-500">
                      <Check size={12} />
                    </div>
                  </div>
                  <div className="flex-grow">
                    <h3 className="font-bold text-sm">
                      {t("categories.necessary.title")}
                    </h3>
                    <p className="text-xs text-zinc-500">
                      {t("categories.necessary.description")}
                    </p>
                  </div>
                  <span className="text-[10px] font-bold uppercase text-zinc-400 mt-1">
                    Required
                  </span>
                </div>

                {/* Functional */}
                <label className="flex items-start gap-4 p-4 rounded-xl border hover:bg-zinc-50 cursor-pointer transition-colors">
                  <div className="mt-1">
                    <input
                      type="checkbox"
                      checked={preferences.functional}
                      onChange={(e) =>
                        setPreferences({
                          ...preferences,
                          functional: e.target.checked,
                        })
                      }
                      className="w-5 h-5 rounded border-zinc-300 text-black focus:ring-black"
                    />
                  </div>
                  <div className="flex-grow">
                    <h3 className="font-bold text-sm">
                      {t("categories.functional.title")}
                    </h3>
                    <p className="text-xs text-zinc-500">
                      {t("categories.functional.description")}
                    </p>
                  </div>
                </label>

                {/* Marketing */}
                <label className="flex items-start gap-4 p-4 rounded-xl border hover:bg-zinc-50 cursor-pointer transition-colors">
                  <div className="mt-1">
                    <input
                      type="checkbox"
                      checked={preferences.marketing}
                      onChange={(e) =>
                        setPreferences({
                          ...preferences,
                          marketing: e.target.checked,
                        })
                      }
                      className="w-5 h-5 rounded border-zinc-300 text-black focus:ring-black"
                    />
                  </div>
                  <div className="flex-grow">
                    <h3 className="font-bold text-sm">
                      {t("categories.marketing.title")}
                    </h3>
                    <p className="text-xs text-zinc-500">
                      {t("categories.marketing.description")}
                    </p>
                  </div>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setShowCustomize(false)}>
                  Back
                </Button>
                <Button
                  onClick={() => savePreferences(preferences)}
                  className="bg-black text-white rounded-xl px-8"
                >
                  {t("save")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
