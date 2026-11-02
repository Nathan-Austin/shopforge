# Roadmap

Planned work for shopforge, roughly in order.

## 1. Storefront and orders

- [x] Cart and add-to-cart — done 2026-11-02 on `feat/cart`: httpOnly
      `shop_cart_session` cookie, server actions, /shop and /cart pages,
      header count, guest-cart merge on sign-in, cookie-based checkout
- [ ] Product detail page
- [ ] Orders tables and Stripe webhook, so paid checkouts are recorded
- [ ] Order confirmation email
- [ ] Admin orders view

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

**Decide: `cost_price_cents` is readable by anyone.**

`products` has `for select using (true)` and the anon key is public, so the
Data API will return the new `cost_price_cents` (and `sku`, `barcode`) to
anyone, even though the field is labelled "admin only, never shown to
customers". Options, cheapest first: move cost price to an owner-only table;
or `revoke select (cost_price_cents) on public.products from anon` (works
today because the storefront selects explicit columns and only the shop
owner's authenticated role uses `select('*')`, but it breaks the moment any
anon query uses `select('*')`); or a `products_public` view with direct
select revoked, which is the tidiest and the most work. Not done: it changes
the schema contract, so it is your call.

**Known gaps in the generated store (not build failures):**

- The storefront doesn't read most of the new product fields yet: `/shop` and
  the product page are still placeholders, so headline, gallery, tags, stock
  and the rest are saved but only visible in the admin. Wire them in with the
  storefront work in section 1.
- Stock is checked when adding to the cart and again at checkout, but it is
  never reserved, so two customers can both pay for the last unit. Decrementing
  stock belongs with the Stripe webhook and the orders work.
- The cart is not merged on sign-*up*, only on sign-in.
- `/checkout` is still a placeholder: the API route works from the cookie but
  nothing posts to it yet.
- Money is entered in major units and stored as cents everywhere, but the
  currency is per product and free text. A store-level currency belongs with
  the store settings work above.
- `pnpm build` only warns, not fails, when Tailwind isn't wired in. Check the
  build log for "Unknown at rule: @theme" if styles ever disappear again.
- Next 16 does not run ESLint during `next build`; `pnpm lint` is a separate
  step (the test script runs it).
- create-next-app pins `@types/node@^20` and the eslint 9 line (deprecated
  upstream); both are its own choices and harmless today.
