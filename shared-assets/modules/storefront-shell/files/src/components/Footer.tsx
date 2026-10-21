import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { isEmailSubscribed } from "@/lib/marketing/mailing-list";
import FooterNewsletterForm from "@/components/FooterNewsletterForm";

async function getInitialSubscribed(email: string | null): Promise<boolean> {
  if (email) {
    return isEmailSubscribed(email);
  }

  const cookieStore = await cookies();
  return cookieStore.get("newsletter_signed_up")?.value === "true";
}

export default async function Footer({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "Footer" });
  const tNewsletter = await getTranslations({ locale, namespace: "Newsletter" });
  const currentYear = new Date().getFullYear();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const initialSubscribed = await getInitialSubscribed(user?.email ?? null);
  const br = { br: () => <br /> };

  return (
    <>
      <section className="newsletter">
        <div>
          <span className="eyebrow">{tNewsletter("bandEyebrow")}</span>
          <h2>{tNewsletter.rich("bandTitle", br)}</h2>
          <p>{tNewsletter("bandDescription")}</p>
        </div>
        <FooterNewsletterForm
          locale={locale}
          initialSubscribed={initialSubscribed}
        />
      </section>

      <footer className="store-footer">
        <div className="footer-top">
          <div>
            <Link href={`/${locale}`} aria-label="Your Store home">
              <Image
                src="/images/logo.png"
                alt="Your Store"
                width={135}
                height={54}
              />
            </Link>
            <p>{t.rich("tagline", br)}</p>
          </div>
          <div>
            <h3>{t("shop")}</h3>
            <Link href={`/${locale}/shop`}>{t("allSauces")}</Link>
            <Link href={`/${locale}/shop?category=gift-boxes-sets`}>
              {t("giftBoxes")}
            </Link>
            <Link href={`/${locale}/shop?category=superhot`}>
              {t("superhot")}
            </Link>
          </div>
          <div>
            <h3>{t("information")}</h3>
            <Link href={`/${locale}/shipping-returns`}>{t("shipping")}</Link>
            <Link href={`/${locale}/terms`}>{t("terms")}</Link>
            <Link href={`/${locale}/privacy`}>{t("privacy")}</Link>
            <Link href={`/${locale}/legal`}>{t("legal")}</Link>
          </div>
          <div>
            <h3>{t("contact")}</h3>
            <a href="mailto:hello@example.com">hello@example.com</a>
            <a
              href={`https://wa.me/${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("whatsapp")}
            </a>
            <a
              href="https://www.instagram.com/example.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Instagram
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {currentYear} Your Store. {t("rights")}
          </span>
          <span>
            Stripe <b>Bancontact</b> iDEAL
          </span>
        </div>
      </footer>
    </>
  );
}
