# Roadmap

Planned work for shopforge, roughly in order.

## Next up

The current priority list. Keep it up to date as work lands: remove or tick
finished items, reorder when priorities change, and add new ones. The
details for each item are in the numbered sections below.

1. **Render `ProductArchive` on `/shop`** (section 1). The component (search,
   category filters, sorting) is built and translated but not rendered yet.
   Small effort, large visible improvement.
2. **Stripe refunds from `/admin/orders`** (section 1). Marking an order
   `refunded` changes only the label today. Add full and partial refunds
   through the Stripe API.
3. **Shipping notification email** (section 1). Email the customer via Resend
   when the owner marks an order fulfilled or otherwise changes its status.
   The template and transport exist already; what's missing is the hook on
   status change.
4. **Discount codes, then the email marketing builder** (section 2). Discount
   codes backed by Stripe coupons/promotion codes and applied at checkout,
   then the block-based campaign editor with an opt-in/unsubscribe
   subscriber list.
5. **Translate the auth pages** (section 2b). Move the hardcoded English on
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
- [ ] Render `ProductArchive` (search, filters, sorting) on `/shop` in place
      of the plain grid
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
- [x] Admin orders view, with status changes (fulfilled, cancelled, refunded)
      recorded in the database only — done 2026-11-03 via `set_order_status()`
- [ ] Refunds from the admin: a "refund" action that calls Stripe for the
      full order or for chosen order items (partial refund), then records
      the status. Today the status is only a label; the money has to be
      refunded in the Stripe dashboard
- [ ] Guest-cart merge on sign-*up*, not just sign-in

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
- `ProductArchive` and `BrandShowcase` are copied into every store and have
  all their message keys, but nothing renders them yet.
- The buying loop is closed end to end: pay, order recorded, receipt
  emailed, customer sees it at `/account/orders`, owner manages it at
  `/admin/orders`. What is missing around it is money movement (refunds)
  and later-stage notifications (shipping emails).

**Known gaps in the generated store (not build failures):**

- `/shop` is still a plain grid that reads only the card fields; the product
  page shows every public field except `video_url`, and brand and category
  are plain text because there are no brand or category pages to link to
  yet.
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
- Marking an order `refunded` in the admin records the label only. No money
  moves: refund it in the Stripe dashboard as well, until the refund action
  in section 1 is built.
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
