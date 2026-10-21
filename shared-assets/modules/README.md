# Shared modules

Optional feature modules for shopforge stores. The generator doesn't install
them yet; they're kept here to be integrated into the scripts. Each module
folder contains:

- `files/`: mirrors a store's project root (e.g.
  `files/src/lib/security/rateLimit.ts` becomes `src/lib/security/rateLimit.ts`).
- `migrations/`: the module's schema migrations. Numbers are shared across
  modules, so applying every module's migrations in numeric order gives the
  right sequence.
- `module.json` + `README.md` (security only so far): npm deps, env vars,
  ordered migrations and usage notes.

Modules contain no store data or branding. Store-specific values come from
environment variables and placeholders (see below).

## Status

`security` is packaged and tested on its own. The other modules type-check
together as one app, but haven't yet been installed by the generator or run
end-to-end.

| Module | Contents | Imports from |
| --- | --- | --- |
| `security` | Rate limiting, honeypot/timing guards, origin check, disposable email filter, Turnstile (+ tests) | `lib` |
| `core` | Supabase clients, `ui/` components, i18n, `proxy.ts`, `next.config.ts`, admin layout/auth/dashboard, ImageUploader, RichTextEditor, NotificationsBell, `en.json`. Migrations: base schema, auto profile, translation columns, security hardening | `auth` |
| `auth` | Sign-in/up, password reset, MFA setup/verify, session + sign-out routes, MFA recovery script | `core`, `lib`, `security` |
| `account` | Account page, profile form, profile API, date of birth | `core`, `security` |
| `storefront-shell` | Locale layout, Header, Footer, MobileMenu, LocaleSwitcher, CookieConsent, WhatsApp button | `core`, `marketing` |
| `catalog` | Shop listing/detail, admin products/brands, variants, image gallery, archive, sale prices, in-stock flag, Product JSON-LD, Google feed, sitemap, robots | `checkout`, `core`, `lib`, `reviews`, `shipping-zones` |
| `checkout` | Cart, checkout, Stripe session + webhook, pricing, shipping config, orders tables, order numbers, webhook logs, notifications | `core`, `emails`, `lib`, `marketing`, `orders-admin`, `security`, `shipping-zones` |
| `orders-admin` | Admin orders list/detail, ship + tracking, refunds, packing-slip PDF + signed link, customer page, account order history, sales analytics | `checkout`, `core`, `emails`, `lib` |
| `reviews` | Review submission, verified-buyer check, review reward discount, review reminder cron, product reviews component, admin moderation, reviews page | `core`, `emails`, `security`, `vouchers` |
| `events` | Admin events editor and public events page (table lives in reviews `0124`) | `core` |
| `vouchers` | Admin vouchers, Stripe coupons, one-time discount codes, redemption report script | `checkout`, `core` |
| `shipping-zones` | Admin-editable zones, countries and weight brackets (seeds one editable worldwide zone) | `core` |
| `away-mode` | Pause the shop until a return date, auto-return cron | `core` |
| `emails` | Resend client, transactional templates, email image proxy, test-send route | `core`, `marketing` |
| `marketing` | Newsletter double opt-in, mailing list, Mailchimp/Resend sync, campaign builder + sending, Resend webhook, newsletter popup/footer form | `core`, `emails`, `security`, `vouchers` |

`lib` means `shared-assets/lib` (currently needed for `lib/supabase/admin.ts`).
The `shared-assets/lib` copies of `format.ts`, `stripe/server.ts`,
`shipping/config.ts` and `checkout/pricing.ts` are older than the versions in
`core` and `checkout`.

## Configuration

| Setting | Used by | Purpose |
| --- | --- | --- |
| `NEXTAUTH_SECRET` | `orders-admin`, `marketing` | Signs packing-slip and unsubscribe links. Must be random and 32+ characters; without it, creating a link throws and verifying one fails. |
| `EMAIL_FROM` | `emails`, `marketing` | Sender for all email, e.g. `My Shop <hello@myshop.com>` |
| `SELLER_EMAIL` | `emails`, `checkout` | Where new-order notifications go |
| `NEXT_PUBLIC_HOME_COUNTRIES` | `catalog` | ISO alpha-3 codes that get the faster delivery estimate in Product JSON-LD |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `storefront-shell` | Google Analytics measurement ID |
| `GOOGLE_PRODUCT_CATEGORY` | `catalog` | Optional Google product taxonomy category for the Merchant Center feed; omitted when unset |

Placeholders to replace: `Your Store` (store name), `example.com` (site and
social links), `hello@example.com` (contact address) and `YOUR_PROJECT_REF`
(Supabase Storage URLs in email templates and `next.config.ts`). Image paths
such as `/images/logo.png` and `/images/maker.jpg` need your own assets.

## Known work before these are reusable

- **Wire into the generator:** install a module's files, npm deps, migrations
  and `en.json` keys from the scripts, resolving the imports listed above.
- **Chilli fields:** `catalog` components use the chilli store mode's heat
  levels and chilli types. The migrations that add `capsaicin`, `pairing`,
  `is_vegan` and `is_sugar_free` aren't included yet.
- **Shipping carriers:** the ship-order form offers PostNL, bpost, DHL and DPD;
  make the list configurable.
- **Tax:** `checkout/lib/checkout/pricing.ts` assumes a single VAT rate
  (`STANDARD_TAX_RATE`, 6%).
- **Tests:** two `auth` sign-up tests (`auth.test.ts`) currently fail and need
  updating to the current sign-up action.
