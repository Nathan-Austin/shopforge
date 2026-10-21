import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { locales } from "@/i18n/navigation";
import { setRequestLocale, getMessages } from "next-intl/server";
import { Montserrat } from "next/font/google";
import Script from "next/script";
import "../globals.css";
import "../storefront.css";
import type { ReactNode } from "react";
import type { Viewport } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import NewsletterPopup from "@/components/store/NewsletterPopup";
import CookieConsent from "@/components/store/CookieConsent";
import WhatsAppButton from "@/components/WhatsAppButton";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const fontSans = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

const RTL_LOCALES = new Set(["ar", "fa", "he", "ur"]);

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Dotted paths skip the locale proxy, so e.g. /wp-login.php lands here
  // with locale "wp-login.php" -- 404 instead of rendering the homepage.
  if (!hasLocale(locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();
  const dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        {/* Google Consent Mode Default State */}
        <Script id="google-consent-mode" strategy="beforeInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            
            // Default consent to 'denied'
            gtag('consent', 'default', {
              'ad_storage': 'denied',
              'ad_user_data': 'denied',
              'ad_personalization': 'denied',
              'analytics_storage': 'denied',
              'wait_for_update': 500
            });
          `}
        </Script>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());

            gtag('config', '${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}');
          `}
        </Script>
      </head>
      <body
        className={`${fontSans.variable} min-h-screen bg-white text-gray-900 antialiased font-sans flex flex-col`}
      >
        <NextIntlClientProvider messages={messages}>
          <Header locale={locale} />
          <main className="flex-grow w-full min-w-0">{children}</main>
          <Footer locale={locale} />
          <NewsletterPopup locale={locale} />
          <CookieConsent />

          <WhatsAppButton number={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? ""} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
