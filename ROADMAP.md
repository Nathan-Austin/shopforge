# Roadmap

Planned work for shopforge, roughly in order.

## Next up

The current priority list. Keep it up to date as work lands: remove or tick
finished items, reorder when priorities change, and add new ones. The
details for each item are in the numbered sections below.

1. **Shipping notification email** (section 1). Email the customer via Resend
   when the owner marks an order fulfilled or otherwise changes its status.
   The template and transport exist already; what's missing is the hook on
   status change.
2. **Discount codes, then the email marketing builder** (section 2). Discount
   codes backed by Stripe coupons/promotion codes and applied at checkout,
   then the block-based campaign editor with an opt-in/unsubscribe
   subscriber list.
3. **Translate the auth pages** (section 2b). Move the hardcoded English on
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
      yet); cards keep their add-to-cart button; a mode-specific
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
- [ ] Shipping notification email when the owner marks an order fulfilled
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
- [ ] Webhook handlers for `charge.refunded` and `charge.dispute.*`, so a
      refund made in the Stripe dashboard, or a chargeback, is reflected in
      `refunded_cents` and the order status. Disputes are the one the owner
      really needs to hear about
- [ ] Optional restock on refund: a checkbox on the refund form that puts
      the refunded units back into stock
- [ ] "Reconcile with Stripe" for a refund row stuck in `pending` (the app
      died between reserving and Stripe answering): look the attempt up by
      idempotency key / metadata and complete or fail the row
- [ ] Zero-decimal currencies (JPY, KRW, ...): amounts are sent to Stripe as
      stored cents everywhere, which is off by 100 for these
- [ ] Numbered migration files for changes after `0001_init.sql`, so a live
      store can be upgraded without re-running the whole (idempotent) schema

## 2. Admin and store settings

- [ ] Categories and brands admin
- [ ] Store settings (currency, shipping zones) in the database, replacing the
      hardcoded `src/lib/shipping/config.ts`
- [ ] Admin UI for `src/lib/products/config.ts`: tick which product fields the
      shop manages, without editing the file. The columns already all exist,
      so this needs no migration
- [ ] Admin UI for the heat scale: rename or drop the word bands and switch
      how heat appears in the shop (word and number, word only, number only,
      chilli icons). `HEAT_SCALE.display` already drives `formatHeat`
- [ ] Theme tokens instead of hardcoded colours
- [ ] Discount codes: an admin page to create and retire them, backed by
      Stripe coupons/promotion codes, applied at checkout and recorded on
      the order. Needed by the email marketing builder below
- [ ] Email marketing page in the admin: a block builder where the owner
      composes a campaign from image, text, button/link and discount-code
      blocks, previews it, and sends to a customer list. Needs the discount
      codes above, a subscriber list with opt-in and unsubscribe, and the
      transactional email provider already wired in for sending

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

## 5. CI

- [x] Vitest in generated stores, with unit tests for the heat scale,
      product field parsing, shipping and formatting — done 2026-11-02
- [ ] CI that generates a store and builds it: run
      `test/generate-and-check.sh --mode=generic` and `--mode=chilli` (needs
      Node, pnpm and python3; no Supabase project required)

## Notes for future turns

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
  `/admin/orders`. What is missing around it is money movement (refunds)
  and later-stage notifications (shipping emails).

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
- Refunds made in the Stripe dashboard (or disputes/chargebacks) are not
  seen by the shop: the webhook only handles `checkout.session.completed`.
  Handling `charge.refunded` and `charge.dispute.*` would keep
  `refunded_cents` honest either way.
- A refund does not put stock back. Restocking is a judgement call (was the
  item returned?), so it is left to the owner in the product form for now.
- Amounts are sent to Stripe as the stored cents. Zero-decimal currencies
  (JPY, KRW) would be off by a factor of 100 throughout checkout and
  refunds alike; nothing in the generator handles them yet.
- Changing an order's status does not notify the customer; the shipping
  notification email in section 1 covers that.
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
