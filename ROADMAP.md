# Roadmap

Planned work for shopforge, roughly in order.

## 0. Direction: from generator to one codebase set up in the browser

Today a shop is created by running the shell generator and then customised
with a coding agent. The aim is a path where a shop owner never needs a
terminal or an agent to get started, and where an agent is only needed to
customise a shop beyond what the admin offers.

- **Choices become settings, not generated code.** Mode (generic or chilli),
  currency, languages, shipping zones and product fields live in the database
  and are switched in the admin. Chilli mode becomes a feature toggle rather
  than a separate template. Several existing items already lead here: store
  settings in the database, the product-field toggles, the heat scale admin.
- **Deploy button.** A "Deploy to Vercel" button in the README, using
  Vercel's Supabase integration to create and link the database.
- **First-run setup wizard in the admin.** Shop name and logo, mode,
  currency and languages, connecting Stripe with a test step, the email
  provider, legal pages.
- **Updates.** Every shop runs the same codebase, so updating is pulling the
  new version and running the numbered migrations. This replaces the need to
  carry template changes into generated stores by hand.
- **Two audiences.** Shop owners use the deploy button and the wizard.
  Developers fork the repo and customise it, with or without a coding agent
  (see section 4).
- **Not a desktop app.** A cross-platform GUI would still need the Node
  toolchain and the same cloud accounts, plus code signing, notarisation and
  auto-updates on three platforms. The browser path gets the same result
  with far less to maintain.

First step: a plan-only session that lists everything decided at generation
time today (flags, mode, prompts in the scripts, files that differ between
modes) and, for each one, what it would take to make it a runtime setting.
No code changes in that session.

- [ ] Plan: inventory of generation-time choices and the route for each to
      become a runtime setting
- [ ] Single codebase with the modes as settings; the generator stays only
      as a developer tool, if at all
- [ ] Deploy to Vercel button with the Supabase integration
- [ ] First-run setup wizard in the admin
- [ ] Upgrade path for shops created by the old generator

## Next up

The current priority list. Keep it up to date as work lands: remove or tick
finished items, reorder when priorities change, and add new ones. The
details for each item are in the numbered sections below.

1. **Email marketing and template builder** (section 2d), in the phases
   listed there, one at a time. A to F, E2 and G1 (model, saved templates
   and test sends, the designer, subscribers, sending through Resend,
   provider keys in the dashboard, Mailchimp, the brand on receipts) are
   done; G2 (editable intro and footer copy per locale) is next, then H
   (more providers, now that the adapter exists).
2. **Translate the auth pages** (section 2b). Move the hardcoded English on
   `/auth/sign-in`, `/auth/sign-up` and `/auth/mfa` into the locale message
   files.

## 1. Storefront and orders

- [x] Cart and add-to-cart — done 2026-11-02 on `feat/cart`: httpOnly
      `shop_cart_session` cookie, server actions, /shop and /cart pages,
      header count, guest-cart merge on sign-in, cookie-based checkout
- [x] Product detail page — done 2026-11-03: `/shop/[slug]` reads
      `products_public` by slug (unknown, unpublished and archived slugs
      404), with gallery, headline, compare-at price, stock status, brand
      and category, size/colour variants, a quantity picker on add to cart,
      long copy, ingredients, net content, weight, dimensions, allergens,
      dietary flags, nutrition, storage, tags and SEO metadata. Chilli shops
      add a heat meter, Scoville and chilli-type chips via `ProductExtras`
- [x] Render `ProductArchive` (search, filters, sorting) on `/shop` in place
      of the plain grid — done 2026-11-03: state lives in the URL (`?q=`,
      `category`, `heat`, `type`, `sort`, slugs as values), parsed on the
      server so filtered links render filtered; `recent` and `popular` were
      no-ops and now mean newest-first and featured-first (no sales counts
      yet; "popular" has since moved to units sold, see the known gaps
      below); cards keep their add-to-cart button; a mode-specific
      `ShopArchive` server component does the fetching
- [x] Orders tables, so paid checkouts are recorded — done 2026-11-03:
      `orders` and `order_items` with RLS (own rows for customers, all for
      the owner), written by the webhook before stock is touched; guest
      checkout with sign-up prompt and `claim_guest_orders()` on confirmed
      email; success page shows the order and polls until the webhook lands;
      cancel page; `--shipping=form|stripe` for who collects the address
- [x] Customer order history page (`/account/orders`), reading via RLS —
      done 2026-11-03
- [x] Order confirmation email — done 2026-11-03: Resend via the webhook,
      optional, escaped HTML template with unit tests, `confirmation_sent_at`
      guards against double sends
- [x] Shipping notification email — done 2026-11-04: marking an order
      Shipped emails the customer once, in the locale they checked out in
      (`orders.locale`, stamped by the webhook), with carrier, tracking
      number and a tracking link (typed, or derived for common carriers).
      `notificationForStatusChange()` is the guard: only the first arrival
      at `fulfilled`, never twice (`shipping_notified_at`), silent on
      flips back and forth; a failed send retries on the next arrival and
      the owner has a send/resend button. Cancellations stay quiet
- [x] Localize the order confirmation and refund emails the same way as the
      shipping one — done 2026-11-04
- [ ] Other status emails behind a per-status switch (cancelled, delivered
      once a carrier integration can report it), each with its own
      once-only marker
- [x] Admin orders view, with status changes (fulfilled, cancelled)
      recorded in the database only — done 2026-11-03 via `set_order_status()`
- [x] Refunds from the admin — done 2026-11-04: `/admin/orders/[id]` refunds
      the rest of the order, chosen lines and quantities, a percentage of
      the total or a typed amount, never more than what is left, after the
      owner types REFUND. `begin_order_refund()` reserves the amount with
      the order row locked, Stripe is called with the refund row id as the
      idempotency key, `complete_order_refund()` records it and marks the
      order `refunded` once nothing is left. The customer is emailed with
      `SHOP_OWNER_EMAIL` in CC. `order_refunds` is the ledger; `refunded`
      can no longer be picked by hand
- [ ] Guest-cart merge on sign-*up*, not just sign-in
- [x] Webhook handlers for `charge.refunded` and `charge.dispute.*` — done
      2026-11-06 in `0009_disputes.sql`. `charge.refunded` is reconciled from
      the charge's cumulative `amount_refunded` and its whole refund list, so
      a replay cannot double-count and a missed delivery is repaired by the
      next one; a refund the admin made is already in the ledger under the
      same Stripe id. Every `charge.dispute.*` event takes one path keyed on
      the dispute's status: opening marks the order `disputed` and remembers
      what it was, winning restores it, losing leaves it disputed. The owner
      is emailed when a dispute opens and when it closes, with the evidence
      deadline, and `/admin/orders/[id]` shows the dispute above the refund
      form. A disputed order cannot be refunded (`begin_order_refund`), and
      neither a disputed nor a refunded order can be moved by hand any more
      (`set_order_status` only checked the target status before)
- [ ] Optional restock on refund: a checkbox on the refund form that puts
      the refunded units back into stock
- [ ] "Reconcile with Stripe" for a refund row stuck in `pending` (the app
      died between reserving and Stripe answering): look the attempt up by
      idempotency key / metadata and complete or fail the row.
      Half-helped by `charge.refunded` (2026-11-06): the money is now counted
      against the order whatever happens, because `refunded_cents` follows
      Stripe's cumulative total. What is left is the stale row — the webhook
      adds a `succeeded` row under Stripe's refund id and the abandoned
      `pending` one stays next to it in the history, so the amounts are right
      but the list reads oddly. Matching the two by metadata is the fix
- [ ] Zero-decimal currencies (JPY, KRW, ...): amounts are sent to Stripe as
      stored cents everywhere, which is off by 100 for these
- [x] Numbered migration files for changes after `0001_init.sql`, so a live
      store can be upgraded without re-running the whole (idempotent) schema
      — done 2026-11-06: `store-modes/<mode>/schema.sql` is split into
      `store-modes/<mode>/migrations/0001_init.sql` (the base, the only part
      that differs per mode) plus `lib/migrations/0002_orders` …
      `0008_email_campaigns`, shared by both modes. Seeds, the single-store
      brand and the storage policies move to the reserved `0100+` band so a
      schema migration added later can never take a number a live shop has
      already applied. `test/check-schema.sh` applies the whole series twice,
      in generator order; `lib/migrations/README.md` has the rules
- [ ] VAT: prices shown including VAT, EU OSS rates by the customer's
      country, VAT shown per order and on emails
- [ ] Invoices: PDF with sequential invoice numbers, attached to the order
      confirmation email and downloadable from the account and the admin
- [ ] Cookie consent banner, GDPR compliant, with analytics off until consent
- [ ] Subscriptions through Stripe Billing: recurring products and boxes,
      with the customer able to pause or cancel from their account
- [ ] Abandoned cart emails, reusing the email builder and subscriber consent
- [ ] Shipping labels through Sendcloud or DHL; carrier tracking feeds the
      "delivered" status and its email
- [ ] Gift cards

## 2. Admin and store settings

- [x] Storage policies — fixed 2026-11-05: `product-images` uploads,
      replacements and deletes are the shop owner's alone
      (`lib/migrations/0102_storage_policies.sql`, tested by
      `test/sql/storage_policies.sql`);
      before, any signed-in user could. Existing shops run the file once in
      the SQL editor (setup guide, step 5)

- [ ] Categories and brands admin
- [ ] Store settings (currency, shipping zones) in the database, replacing the
      hardcoded `src/lib/shipping/config.ts`. The table exists since
      2026-11-19 (`store_settings`, one JSON document per key, see 2d G1);
      what is left is the keys, the admin forms and the readers
- [ ] Shop currency as a generator choice: ask for it in the CLI (default
      EUR), seed products and the admin form with it, and use it as the
      default for amount discount codes and minimums. One currency per shop
      is the decision (2026-11-04); today it is per product and free text
- [ ] Admin UI for `src/lib/products/config.ts`: tick which product fields the
      shop manages, without editing the file. The columns already all exist,
      so this needs no migration
- [ ] Admin UI for the heat scale: rename or drop the word bands and switch
      how heat appears in the shop (word and number, word only, number only,
      chilli icons). `HEAT_SCALE.display` already drives `formatHeat`
- [ ] Theme tokens instead of hardcoded colours (the first step of the theme
      system, see section 2e)
- [x] Discount codes — done 2026-11-04: `/admin/discounts` creates percent,
      amount and free-shipping codes with minimum, date window and usage
      cap; percent/amount codes are mirrored as a Stripe coupon plus
      promotion code and applied by Stripe at checkout, free shipping by
      the shop; the customer applies a code on `/cart` or `/checkout`, it is
      re-checked at payment, and the order snapshots `discount_code` and
      `discount_cents`
- [ ] Discount codes, follow-ups: per-customer limits (one use per email),
      codes restricted to categories or products, automatic discounts with
      no code, and syncing a code's Stripe-side redemption count back when
      a promotion code is also used outside the shop
- [x] Localized order confirmation, refund and shipping emails — done
      2026-11-04 for all three (strings in `Email.*`); listed here only so
      the next email (marketing) follows the same pattern
- [ ] Email marketing page in the admin: broken down into phases in
      section 2d
- [ ] Import from Shopify and WooCommerce product CSV exports (variants,
      images, prices, stock), and customers where the export allows
- [ ] Legal page templates: Impressum, AGB, Widerrufsbelehrung, privacy
      policy, editable in the admin
- [ ] Sales dashboard in the admin: revenue, orders, top products, low stock
- [ ] Low stock alert email to the owner

## 2b. Accounts and sign-in

- [x] Customer sign-in by password or six-digit email code, chosen at
      generation; admin always by password — done 2026-11-03
- [x] Authenticator-app second factor for the admin, required by default —
      done 2026-11-03
- [ ] Translate the auth pages (sign-in, sign-up, email code, MFA, reset);
      they are English-only today
- [ ] Recovery codes for admin MFA, so a lost phone does not lock the owner
      out. Deferred 2026-11-03: unenrolling the factor from the Supabase
      dashboard is the recovery path for now
- [ ] Account page beyond orders: addresses, email change, delete account
- [ ] Staff accounts with limited admin roles
- [ ] Rate limiting on sign-in, sign-up and checkout
- [ ] Content Security Policy and security headers

## 2c. International SEO and Merchant Center

- [x] Country-language market locales (`de-at`) with message fallback,
      lowercase URL prefixes, correct `html lang` — done 2026-11-04
- [x] Canonical, full hreflang set with `x-default`, `noindex` on private
      pages, `robots.txt`, multi-locale `sitemap.xml` — done 2026-11-04
- [x] JSON-LD: `OnlineStore`, `WebSite`, `BreadcrumbList`, `ItemList`,
      `Product`/`Offer`/`Brand` with GTIN, SKU, availability, shipping —
      done 2026-11-04; visible breadcrumbs on the product page
- [x] Merchant Center feed per locale and `/admin/seo` — done 2026-11-04
- [ ] Per-market prices and currency (needs the shop-currency choice above
      first); until then a non-euro market cannot pass Merchant Center review
- [ ] Merchant API sync from the admin (service account + merchant id;
      create the data source once, upsert on save, delete on archive)
- [ ] `ProductGroup` variant markup once variants carry their own SKU/price
- [ ] Reviews and `AggregateRating` on product pages
- [ ] Translated slugs per locale
- [ ] Locale switcher in the header with a non-blocking "also available in"
      hint (Google's preferred alternative to redirects)
- [ ] UCP / agentic checkout eligibility attributes in the feed when Google
      opens it beyond the US early-access programme

## 2d. Email marketing and template builder

An in-house alternative to Mailchimp for small shops (a few thousand
subscribers, about one campaign a month) that sends through the Resend
account the shop already uses for receipts, with adapters for shops that
outgrow it or already use another service. The owner never writes HTML:
campaigns are composed from blocks with a word-processor style toolbar.
Both store modes get it; chilli shops get heat on product blocks and their
own starter templates.

Working files from development and tests (build logs, send logs, preview
HTML) go under `/tmp/sf-<branch>-email-builder/` (`EMAIL_TMP_DIR`), never
loose in `/tmp`.

- [x] **A. Template model and renderer** — done 2026-11-05 in
      `src/lib/email/campaigns/` (`schema.ts`, `render.ts`, `richText.ts`,
      `mergeTags.ts`, `localize.ts`) and `src/lib/email/tmpDir.ts`, with
      `Email.campaign` strings in en, de, tr and ar. Not used by any page
      yet; B and C wire it in. A Zod 4 schema for a campaign
      document: heading, rich text (a Tiptap JSON subset: bold, italic,
      underline, strike, links, font sizes, colour, lists, alignment),
      image, button, product, discount code, divider, spacer, and 2 or 3
      column sections that stack on phones. Text per locale with the shop's
      fallback (`de-at` -> `de` -> default), merge tags (`{{subscriber.first_name|there}}`)
      checked against a registry, a brand theme, and size limits. A pure
      renderer to table-based email HTML plus plain text that drops a bad
      block with a warning instead of failing the email. Unit tests
- [x] **B. Saved templates and test sends** — done 2026-11-05:
      `email_templates` (owner-only RLS, edit-only `updated_at`),
      `/admin/email` and `/admin/email/[id]`, actions in
      `actions/emailTemplates.ts`, rendering and sending in
      `src/lib/email/campaigns/server.ts`, mode hooks and starters in
      `admin/email/mode.ts`, the `{{shop.locale_url}}` merge tag, and
      `test/check-schema.sh` for the SQL tests. `saveEmailTemplate` already
      accepts a document for C. `email_templates` table
      (owner-only RLS, document validated on every save), save, duplicate
      and delete actions, and "send a test to me" through Resend returning
      a structured result that is also appended as JSON lines to
      `$EMAIL_TMP_DIR/logs/`. A plain `/admin/email` page to create a
      template from a starter, preview it (desktop/phone, per language),
      duplicate, delete and test-send it, until the designer replaces it
- [x] **C. The designer** — done 2026-11-05 on `/admin/email/[id]`:
      `components/email-designer/` (Tiptap 3 toolbar, drag and drop into
      and out of columns, product search, live codes, image upload as
      JPEG/PNG/GIF at most 1200px, language bar with untranslated counts,
      browser-side preview, undo/redo, Ctrl+S), document operations in
      `src/lib/email/campaigns/editor.ts`, Tiptap output folded into the
      schema by `richTextSanitize.ts`. Checked by hand in Chrome
      (English, German, Arabic admin, phone width). Block palette, reorder,
      settings panel per block, Tiptap toolbar, product and discount-code
      pickers, column sections, a merge-tag menu, a locale switcher that
      flags missing translations, desktop/phone preview, starter templates
      per store mode. Tiptap 3 for the text toolbar (approved 2026-11-05)
- [x] **D. Subscribers** — done 2026-11-05: `email_subscribers` and
      `email_subscriber_events` (owner-only, SQL-tested), signed links in
      `src/lib/email/subscribers/` (`tokens.ts`, `links.ts`), the rules,
      CSV and service there too, `/[locale]/newsletter/confirm` and
      `/unsubscribe` (a button, never on open), `POST
      /api/email/unsubscribe` (RFC 8058), the footer form with a bot trap,
      the checkout box, `/admin/email/subscribers`. Checked end to end in
      Chrome against PostgREST. Follow-ups: a per-IP limit on sign-ups
      (today: per address, every ten minutes), and the owner editing a
      subscriber's name or language. `email_subscribers` with double opt-in (required,
      decided 2026-11-05) and a
      consent record, a signed unsubscribe link and one-click
      `List-Unsubscribe` (RFC 8058), sign-up in the footer and at checkout,
      the admin list with CSV import and export
- [x] **E. Sending campaigns** — done 2026-11-05 with Resend Broadcasts:
      `email_campaigns` and `email_audiences`, `src/lib/email/providers/resend.ts`,
      `subscribers/sync.ts` (one audience per language, Resend's own
      unsubscribes read back, one contact per request within a time
      budget), `campaigns/send.ts` (one broadcast per language, send now
      or schedule, status read back), `/admin/email/campaigns`. Checked end
      to end against PostgREST and a stand-in for Resend's API; not yet
      against Resend itself. Decided 2026-11-05: Resend only for now,
      Mailchimp is a later item (below). Follow-ups: cancelling a scheduled
      campaign from the admin (today: in Resend's dashboard, then refresh);
      a Resend webhook so an unsubscribe at Resend reaches the shop at once
      rather than at the next sync; bounces and complaints; a batch
      contacts endpoint if Resend adds one (a first sync of 3,000 people
      takes about 25 minutes at two requests a second); the audience's
      size against the Resend plan shown before sending.
      Campaigns never go through the transactional send path, which is
      for receipts and single test sends only
- [x] **E2. Mailchimp** — done 2026-11-07. `providers/types.ts` is the shape
      a campaign provider has to answer; Resend and Mailchimp both do, so
      `subscribers/sync.ts` and `campaigns/send.ts` are written once and
      neither knows which is behind them. `providers/mailchimp.ts` bridges
      the two differences in Mailchimp's model: one audience with a tag per
      language rather than an audience each (creating a list through the API
      needs a postal address the shop has not got), and members addressed by
      the MD5 of their lowercased address. An audience id is therefore
      `"<list id>:<tag>"`, packed and unpacked in that file alone, so nothing
      above it changed. Merge tags map to `*|FNAME|*`, `*|EMAIL|*` and
      `*|UNSUB|*`; a schedule is rounded up to the quarter hour Mailchimp
      insists on. `0011_mailchimp.sql` widens the three provider columns,
      puts the provider in `email_audiences`' key, and keeps one `is_active`
      key by partial unique index. `/admin/email/settings` picks the
      provider and holds a key for each. Receipts stay with Resend — there
      is no transactional product behind a Mailchimp key. Checked against a
      stand-in for Mailchimp's API, not against Mailchimp itself.
      Follow-ups: a Mailchimp webhook so an unsubscribe there reaches the
      shop before the next sync, as for Resend; `listContacts` reads the
      whole list per language because Mailchimp's members endpoint has no
      tag filter, which is correct but wasteful on a big list; and moving
      subscribers between providers, which today means syncing each language
      again from empty
- [x] **F. Provider keys** — done 2026-11-07. `/admin/email/settings` (a
      fourth tab) shows the active provider and sender, and takes the key.
      The key is tested with `listAudiences` and only a key the provider
      accepted is stored, through `set_email_provider_key` into Supabase
      Vault (`0010_email_provider_keys.sql`); `public.email_provider_keys`
      holds the Vault secret's name, when it was set, who by, and the last
      four characters, and never the key. Write-only is enforced, not just
      shown: `get_email_provider_key` has execute revoked from
      `authenticated`, so the signed-in owner cannot read back what they
      typed even by calling the RPC. The field empties on success and the
      notice says the key will not be shown again, that a copy comes from
      the provider, and that replacing means entering a new one.
      `resolveEmailConfig()` / `resolveNewsletterStatus()` read the key from
      the environment first, then Vault, so `RESEND_API_KEY` still wins and
      remains the way out if Vault is unavailable; the settings page says so
      when it is set. Not done from F's original wording: the generator
      still only writes empty `RESEND_API_KEY` and `EMAIL_FROM` placeholders
      rather than asking for them — the dashboard is the better route now,
      and a prompt would have to stay quiet under `--skip-supabase`, which
      CI uses. Other follow-ups: a scoped "sending only" key check, since
      today any valid key passes the test; and reading the key once per
      request rather than on a one-minute cache
- [x] **G1. The brand on transactional emails** — done 2026-11-19. One
      shop-wide email brand (the campaign theme plus a footer per locale)
      in `store_settings` under `email_brand` (`0012_store_settings.sql`:
      a key/JSON table, readable by everyone, written by the owner, meant to
      hold the other store settings as they land). `lib/email/brand.ts` is
      the schema, with a lenient reader so a broken row can never stop a
      receipt; `lib/email/layout.ts` is the frame the receipt, shipping and
      refund renderers now share (the campaign renderer's tables, logo,
      colours and font stacks, button text black or white by contrast).
      The webhook, the shipping action and the refund action load the
      brand through `brandStore.ts`. `/admin/email/settings` has the form
      (colour pickers, font, logo upload or address, width, footer per
      language) and a sample receipt rendered in the saved brand. A new
      campaign template starts from the brand once one is saved; before
      that the starter's own accent colour stays. The owner-facing dispute
      alert keeps its plain look. Follow-ups: the hairline between rows is
      an 8-digit hex colour, which Outlook for Windows drops (no line, not
      a wrong one); "send me a sample" for the three emails
- [ ] **G2. Editable intro and footer copy per locale** for the receipt,
      shipping and refund emails, falling back to the `Email.*` strings,
      with a test send of each type to the owner; the order details stay
      generated in code (scope confirmed 2026-11-05)
- [ ] **H. More providers** behind the same adapter, the popular ones for
      small shops: Brevo, MailerLite, Kit, Klaviyo (e-commerce focused) and
      Mailjet. The adapter is `src/lib/email/providers/types.ts` since E2;
      each new one is a file there, a name in `CAMPAIGN_PROVIDERS`, and the
      three provider checks widened in a migration

## 2e. Themes

Shop owners pick a theme in the admin, the way they would in Shopify or
WordPress. A theme is a small preset file, not a fork of the components, so
the token system and the layout variants come first and the themes after.

What a theme is:

- **Tokens:** colours (light and dark), fonts, type scale, border radius,
  spacing, shadows and button style, applied as CSS variables that Tailwind 4
  reads. No hardcoded colours or fonts left in the components.
- **Layout variants**, chosen per theme: product card (minimal, image-led,
  bordered, overlay), product page (gallery left, full-width hero, stacked),
  shop page (column count, filters at the side or on top), header and footer
  styles.
- **Stored as a setting.** The chosen theme and any overrides live in the
  store settings, in line with section 0. Chilli mode can ship its own set of
  heat-themed presets.

Rules for creating themes, including when an agent researches them on the
web:

- Research is for inspiration and conventions only: trends, palettes, font
  pairings, common page patterns. Every theme is original; do not reproduce
  a specific existing theme (Shopify, ThemeForest, WordPress premium themes
  are copyrighted or licensed). Describe a theme by its style ("minimal",
  "editorial", "bold streetwear", "artisan food"), not by another product.
- Fonts must be openly licensed (for example Google Fonts under the OFL),
  self-hosted with `next/font`, with the licence recorded in the theme.
- No images taken from the web. Demo data uses placeholder or generated
  imagery.
- Every theme passes WCAG AA contrast for text, links and buttons, checked
  automatically.

Order of work, one session each:

- [ ] Tokens: move every colour, font, radius and shadow into CSS variables
      driven by a theme preset; the current look becomes the default theme
- [ ] Layout variants for the product card, product page, shop page, header
      and footer, selected by the theme
- [ ] Theme picker in the admin with a live preview, saved to store settings;
      owners can override colours and fonts on top of a theme
- [ ] Theme gallery page that renders the shop, a product page and the cart
      in every theme, with Playwright screenshots in CI
- [ ] Contrast check in CI for every theme
- [ ] Ten starter themes, a few per turn, each with a name, a one-line style
      description, its tokens, its layout choices and its font licences

## 3. Languages

- [ ] Full `de`, `tr` and `ar` translations

## 4. Generator

- [x] Fix the first `pnpm add` failing on pnpm 11 with `ERR_PNPM_IGNORED_BUILDS`
      (new build scripts need approving in `allowBuilds`) — done 2026-11-02
- [x] Fix the existing `tsc` errors in a generated `generic` store: missing
      `createClient` export in `lib/supabase/client`, missing `@/types/supabase`,
      `ProductForm` default import, `ProductCard` `locale` prop, joined `products`
      typed as an array (admin product page, checkout route), `stripe` not installed
      — done 2026-11-02; a fresh generic store passes install, `tsc`, `lint` and `build`
- [x] `--skip-supabase` flag and `test/generate-and-check.sh` to generate and
      build a store without a Supabase project — done 2026-11-02
- [x] Make a fresh `chilli` store pass the same checks — done 2026-11-02;
      `tsc`, `lint` and `build` are all clean. Fixed: the ProductForm props
      mismatch (now FormData-based like generic), the missing `Chip`
      component, `ProductCard`'s `locale` prop, `BrandCard`'s `heatColor`
      signature, joined rows read via `one()`, and the chilli types
      multi-select, whose absence made `updateProduct` wipe a product's
      chilli types on every save
- [ ] Node CLI replacing the heredocs in the shell scripts
- [ ] Docker self-hosting path alongside Vercel
- [ ] Payment adapters: Stripe, Mollie, PayPal
- [ ] Until the single codebase lands: a documented way to bring template
      improvements into an existing generated store
- [ ] Demo store, screenshots and a short feature list in the README
- [ ] `AGENTS.md` in every shop: structure, conventions, where things live,
      what not to touch (migrations, RLS), how to run the checks
- [ ] Guide: customising your shop with an AI assistant, as example requests
      plus what to check afterwards (theme, new product field, new page,
      new email)
- [ ] Generator: when the machine has no git identity, skip the first commit
      with a warning instead of failing

## 5. CI

- [x] Vitest in generated stores, with unit tests for the heat scale,
      product field parsing, shipping and formatting — done 2026-11-02
- [x] CI that generates a store and builds it — done 2026-11-06:
      `.github/workflows/ci.yml` runs `test/generate-and-check.sh` for
      `generic` (`--shipping=form`) and `chilli` (`--shipping=stripe`) as a
      two-job matrix, behind a seconds-long `bash -n` gate, alongside
      `test/check-schema.sh --mode=all`. On pull requests, pushes to `main`,
      and daily — the schedule is what catches an upstream Next or Tailwind
      release breaking the scaffold with nothing here having changed. No
      secrets and no Supabase project; a failed build uploads its log
- [ ] End-to-end checkout test in CI with Stripe test mode: cart, payment,
      webhook, order, confirmation email
- [ ] Lighthouse and accessibility checks in CI with a performance budget
- [ ] Renovate or Dependabot for dependency updates
- [ ] Tests: fixtures must not match real key formats (a Mailchimp-shaped
      test key was blocked by GitHub push protection on 2026-11-07); use
      values like `test-mailchimp-key-us21`

## Notes for future turns

Dependency audit, 2026-11-04: the generator installs the latest of
everything at generation time, and on this date that meant Next 16.4,
React 19.3, stripe 23.1 (API 2025-09-30.clover shapes), @supabase/supabase-js
2.118, @supabase/ssr 0.12, next-intl 4.14, zod 4.6, Tailwind 4.3, Vitest 5.1,
Supabase CLI 3.0. Nothing was behind. Changes made: Node 20.9 is checked up
front; create-next-app gets every option stated (saved preferences could
otherwise change a scaffold); the Supabase CLI is run as `npx supabase@3`
with `db push --remote --yes`; the admin guard uses `getClaims()` /
`getUser()` instead of `getSession()`; `z.email()` replaces the deprecated
`z.string().email()`; the webhook accepts both the old and the new
Checkout Session address shape. Still pinned by create-next-app itself:
ESLint 9 (deprecated upstream, ESLint 10 exists) and `@types/node` 20.

Decided on 2026-11-03:

- Guest checkout stays open, and a guest's orders are attached to an account
  only once that account's email is **confirmed**. The shop therefore depends
  on Supabase's "Confirm email" setting being on; the setup guide says so.
- The success page finds an order by its Stripe session id with the
  service-role key, because the buyer may be a guest with no RLS identity.
  Reviewed and accepted: the id is high-entropy and only the paying browser
  is given it.
- Orders have no update policy at all. `set_order_status()` is the single
  write path and re-checks `is_shop_owner()`, so the Data API cannot change
  an order even for the owner.
- Email is optional by design. No `RESEND_API_KEY` and `EMAIL_FROM` means the
  shop sends nothing and behaves exactly as before, so the generator stays
  usable without a Resend account.

Decided on 2026-11-02:

- Generated stores ship with Vitest (dev dependency, Node environment, no
  jsdom) and the tests live beside the code in `shared-assets`. The pure
  helpers have `*On` variants taking the scale or field list as an argument
  so they can be tested for any shop's settings, not just the generated one.

- Product fields are chosen at generation time but **every column always
  exists** in the schema. `src/lib/products/config.ts` only says which ones
  the admin uses, so switching one on later never needs a migration. The same
  file holds the heat scale, which is why the planned admin UI for both is
  cheap to build.
- Heat is stored as a **number**, never a word. Words are display bands in
  `HEAT_SCALE.bands` and every one is optional, so a shop can use three words
  or none. Seed heat values live in `seeds.sql` as `__HEAT_n__` on a 0-10
  basis and the generator rescales them.

- `middleware.ts` renamed to `src/proxy.ts` for Next 16. **With `--src-dir`
  the file must be in `src/`**: a `proxy.ts` in the project root is ignored
  silently, with no build warning, which leaves the store with no locale
  routing (`middleware.ts` did work at the root). `test/generate-and-check.sh`
  now fails if the build output has no `Proxy (Middleware)` line.
- `autoprefixer` and `postcss` dropped from the dev dependencies: Tailwind 4
  goes through `@tailwindcss/turbopack` and there is no `postcss.config`.
- `cacheComponents` and `partialPrefetching` stay **off**. create-next-app
  enables both, but every generated page reads cookies or the Supabase
  session, so each needs a Suspense boundary and `export const dynamic =
  'force-dynamic'` removed first. Revisit once the real storefront pages
  exist and there is something worth caching.

**Where things stand** (the priority order is under "Next up" at the top):

- The storefront has `/shop`, `/shop/[slug]` and `/cart`.
- `BrandShowcase` is copied into every store with its message keys, but
  nothing renders it yet.
- The buying loop is closed end to end: pay, order recorded, receipt
  emailed, customer sees it at `/account/orders`, owner manages it at
  `/admin/orders`. Refunds (from the admin and from Stripe), disputes and
  the shipping email are in place around it (2026-11-04 to 2026-11-06).
  What is missing is mostly the later-stage pieces: other status emails,
  restock on refund, and stock reservation during checkout.
- Email marketing (section 2d) is in place through phase F and E2:
  templates, the designer, subscribers, and campaigns through Resend or
  Mailchimp.

**Known gaps in the generated store (not build failures):**

- The product page shows every public field except `video_url`; brand and
  category are plain text there because there are no brand or category pages
  to link to yet.
- "Popular" on `/shop` ranks by units sold in the last 90 days
  (`product_sales` view) and is hidden until the shop has sold 100 units in
  that window (`POPULARITY_MIN_UNITS`).
- Only `size_options` and `color_options` are cart-selectable variants
  (`cart_items.selected_size` / `selected_color`). Weight and volume are
  display facts (`net_content`, `weight_grams`), not variants; a product
  sold in two sizes is two options on one row, or two products.
- Stock is decremented when Stripe confirms payment, but it is never
  *reserved* during checkout, so two customers can still both pay for the last
  unit. The decrement is atomic and floors at zero, so the count stays sane,
  but one of them gets an apology. Reserving at session creation with a
  timeout is the fix.
- The cart is not merged on sign-*up*, only on sign-in.
- A refund row can stay `pending` if the app dies between reserving it and
  Stripe answering. The amounts stay right (`charge.refunded` reconciles
  `refunded_cents` from Stripe), but the stale row stays in the history;
  see "Reconcile with Stripe" in section 1.
- A refund does not put stock back. Restocking is a judgement call (was the
  item returned?), so it is left to the owner in the product form for now.
- Amounts are sent to Stripe as the stored cents. Zero-decimal currencies
  (JPY, KRW) would be off by a factor of 100 throughout checkout and
  refunds alike; nothing in the generator handles them yet.
- Only the shipped status emails the customer. The owner is not copied on
  shipping emails (they triggered them, and the orders page shows the
  state); receipts and refunds still copy `SHOP_OWNER_EMAIL`.
- Every customer email (receipt, shipping, refund) is sent in the locale
  the customer checked out in, from the `Email.*` namespaces.
- Promo codes are per order, not per customer: nothing stops the same
  person using a code twice from two carts. The usage cap is the only
  brake. Per-email limits are a listed follow-up.
- The auth pages (sign-in, sign-up, email code, MFA) are English-only, even
  in a multilingual shop.
- Money is entered in major units and stored as cents everywhere, but the
  currency is per product and free text. A store-level currency belongs with
  the store settings work above.
- `pnpm build` only warns, not fails, when Tailwind isn't wired in. Check the
  build log for "Unknown at rule: @theme" if styles ever disappear again.
- Next 16 does not run ESLint during `next build`; `pnpm lint` is a separate
  step (the test script runs it).
- create-next-app pins `@types/node@^20` and the eslint 9 line (deprecated
  upstream); both are its own choices and harmless today.
