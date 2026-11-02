# Roadmap

Planned work for shopforge, roughly in order.

## 1. Storefront and orders

- [ ] Cart and add-to-cart
- [ ] Product detail page
- [ ] Orders tables and Stripe webhook, so paid checkouts are recorded
- [ ] Order confirmation email
- [ ] Admin orders view

## 2. Admin and store settings

- [ ] Categories and brands admin
- [ ] Store settings (currency, shipping zones) in the database, replacing the
      hardcoded `src/lib/shipping/config.ts`
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
- [ ] Make a fresh `chilli` store pass the same checks. Known `tsc` errors
      (`test/generate-and-check.sh --mode=chilli`): the chilli `ProductForm` has
      the same props mismatch the generic one had (apply the generic form's
      FormData-based `onSubmit`/`onDelete`/`successRedirectPath` shape, and
      type `categories`/`brands`/`chilliTypes` with the `DbId` store types);
      the edit page reads joined `brand`/`category` as objects (use `one()` from
      `lib/supabase/relations`); `ProductArchive` imports a missing `./Chip`
      component and passes `locale` to `ProductCard`; `BrandCard` passes `DbId`
      where a string is expected
- [ ] Node CLI replacing the heredocs in the shell scripts
- [ ] Docker self-hosting path alongside Vercel
- [ ] Payment adapters: Stripe, Mollie, PayPal

## 5. CI

- [ ] CI that generates a store and builds it (`test/generate-and-check.sh
      --mode=generic` is the command to run; it needs Node, pnpm and python3)

## Notes for future turns

Found on 2026-11-02 while fixing the generic build; not yet acted on.

**Decisions to make (change the generated stack, so ask first):**

- `middleware.ts` is deprecated in Next 16 in favour of `proxy.ts`
  (`npx @next/codemod@canary middleware-to-proxy`). The build still picks the
  file up at the project root, so this is a warning-free deprecation for now.
- create-next-app enables `cacheComponents: true` and `partialPrefetching: true`
  in `next.config.ts`; the generator overwrites that file and leaves them off,
  because the generated pages read cookies/session on every request and would
  need Suspense boundaries (and `export const dynamic = 'force-dynamic'`
  removed) before they could build with `cacheComponents` on.
- The generator still installs `autoprefixer` and `postcss` as dev
  dependencies. Tailwind 4 runs through `@tailwindcss/turbopack`, so they are
  unused; removing them is a dependency change.
- create-next-app pins `@types/node@^20` and the eslint 9 line (deprecated
  upstream); both are create-next-app's choices and harmless today.

**Known gaps in the generated store (not build failures):**

- The admin server actions only persist name, slug, price, currency,
  description, image and category/brand. `details`, `capacity_ml`,
  `ingredients`, `nutrition_info`, `is_active`, `size_options` and
  `color_options` are collected by the form but dropped by
  `createProduct`/`updateProduct`.
- `pnpm build` only warns, not fails, when Tailwind isn't wired in. Check the
  build log for "Unknown at rule: @theme" if styles ever disappear again.
- Next 16 does not run ESLint during `next build`; `pnpm lint` is a separate
  step (the test script runs it).
