# Single codebase: inventory of generation-time choices

Plan only, 2026-11-19 (ROADMAP section 0, first step). No code changed with
this document.

Today a shop is made by `create-next-commerce-template-ssr.sh` (about 5,300
lines after the 2026-11-19 language cleanup) and `extend-commerce-template.sh`
(about 1,550 lines). Both decide things once, at generation, by writing
files, copying a store mode's directory or filling in placeholders. The
direction in section 0 is one codebase that every shop runs, with those
decisions held as settings and changed in the admin.

**No existing shops to carry along.** No shop generated so far uses this
package or receives updates from it (confirmed 2026-11-19). Backward
compatibility with already-generated shops is therefore not a constraint
on any step below, and there is no upgrade path to build. The fallback to
generated files in step 2 stays, but for a different reason: a freshly
generated shop has no settings rows until the owner saves one, and it
must work before then.

This document lists every such decision, where it lands in a generated shop,
who reads it at runtime, and what it would take to make it a runtime
setting. The last sections propose an order and list the questions that
need an answer before code is written.

## How to read the tables

- **Lands in**: the file or environment variable a generated shop carries.
- **Runtime readers**: the code that consults it after generation.
- **Route**: the proposed home once it is a setting.
  `store_settings:<key>` means a row in the `store_settings` table added in
  `0012_store_settings.sql` (one JSON document per key, readable by
  everyone, written by the owner). `env` means it stays an environment
  variable, because it is a secret, an infrastructure fact, or needed before
  the database can be reached.
- **Effort**: S (an afternoon), M (one session), L (several sessions).

## 1. Command-line arguments and flags

| # | Choice | Set by | Lands in | Runtime readers | Route | Effort |
|---|---|---|---|---|---|---|
| 1 | Store mode (`generic` / `chilli`) | `--mode=` on both scripts, default `chilli` | Which `store-modes/<mode>/` directory is copied (admin, store components, `0001_init.sql`, seeds, brand row) and the field picker's catalogue filter | Nothing reads "the mode": it is baked into which files exist | `store_settings:shop` → `{ mode }`, with the chilli parts as a feature toggle. See section 3; this is the large one | L |
| 2 | Locales and default locale | positional args 2 and 3, default `en` and `en,de` | `src/i18n/config.ts` (`LOCALES`, `DEFAULT_LOCALE`); message files copied from English for any language without one | Routing (`src/proxy.ts`), hreflang, sitemap, feeds, emails, the brand form's footer boxes | `store_settings:languages` → `{ locales, defaultLocale }`. Routing reads it at the edge, so it needs a cached read (see Q3). Message files for every supported language ship in the repo; a shop switches them on | M |
| 3 | Delivery address collected by (`form` / `stripe`) | `--shipping=` on the extend script | `src/lib/checkout/config.ts` `CHECKOUT_CONFIG.shippingAddress` | Checkout page, checkout session route, webhook | `store_settings:checkout` → `{ shippingAddress, allowedCountries }` — done 2026-11-20 | S |
| 4 | Skip Supabase (`--skip-supabase`) | flag, or `SHOPFORGE_SKIP_SUPABASE` | Placeholder `.env.local`; no `db push` | Nothing at runtime | Disappears: the deploy button and Vercel's Supabase integration create and link the project (section 0). Stays only as a developer/CI switch | S |
| 5 | Shop folder and package name | positional arg 1 | Folder name, `package.json` name, default `NEXT_PUBLIC_SHOP_NAME` | Shop name in emails, SEO, header (see #10) | Folder disappears (it is the fork). Name moves to #10 | — |

## 2. Interactive prompts (each can also be preset by environment)

| # | Choice | Prompt / variable | Lands in | Runtime readers | Route | Effort |
|---|---|---|---|---|---|---|
| 6 | Single or multi brand | "Store mode (single/multi)", `NEXT_PUBLIC_STORE_MODE` | `.env.local`; single also gets `0101_brand_single.sql` (a "House Brand" row) | `createProduct` / `updateProduct` in both modes (assign the house brand when single) | `store_settings:shop` → `{ brands: 'single' \| 'multi' }`. The house-brand row becomes something the wizard creates, not a migration — done 2026-11-20 (the row is created on saving single with no brands) | S |
| 7 | Customer sign-in (`password` / `otp`) | `SHOPFORGE_CUSTOMER_AUTH` | `src/lib/auth/config.ts` `AUTH_CONFIG.customerSignIn` | Sign-in and sign-up pages, `OtpSignIn` | `store_settings:auth` → `{ customerSignIn, adminMfa }`. Read in the server page and passed to the client form (it is not secret) — done 2026-11-20 | S |
| 8 | Admin MFA (`required` / `off`) | `SHOPFORGE_ADMIN_MFA` | same file, `adminMfa` | Admin guard (`requireShopOwner`, `ensureShopOwner`) | Same row as #7. Turning MFA **off** requires an MFA-verified session, in the admin and in the database (`0013`) — done 2026-11-20 | S |
| 9 | Product fields the admin manages | field picker menu, `SHOPFORGE_PRODUCT_FIELDS` | `src/lib/products/config.ts` `PRODUCT_FIELD_KEYS` (every column exists either way) | Product form, create/update actions, product page, feeds | `store_settings:product_fields` → `{ keys }`. Already planned in section 2 ("Admin UI for products/config.ts"); no migration needed | M |
| 10 | Heat scale (chilli only): max, word bands, display | `SHOPFORGE_HEAT_MAX`, `_BANDS`, `_DISPLAY` | `src/lib/products/config.ts` `HEAT_SCALE`; seeds rescaled from `__HEAT_n__` | `formatHeat`, heat meter, filters, product card | `store_settings:heat` → the `HeatScale` object. Seeds stop being rescaled at generation: store heat on a fixed 0–10 basis and scale at display (Q4) | M |
| 11 | Supabase URL, anon key, service-role key, project ref | `prompt_env_var` | `.env.local` | Every Supabase client | **env**, set by Vercel's Supabase integration | — |

## 3. Environment variables written with defaults

| # | Variable | Default written | Route |
|---|---|---|---|
| 12 | `NEXT_PUBLIC_SHOP_NAME` | the folder name | `store_settings:shop` → `{ name }`. 22 readers today; one `shopSettings()` helper replaces them (S) |
| 13 | `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | **env** (Vercel sets the deployment URL), with a wizard check that it matches |
| — | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_SIGNING_SECRET`, `NEXTAUTH_SECRET` | placeholders / random | **env** or Vault. Stripe could follow the email provider keys into Vault (wizard: "connect Stripe" with a test call), same pattern as `0010` |
| — | `EMAIL_FROM`, `EMAIL_REPLY_TO`, `SHOP_OWNER_EMAIL` | empty | `store_settings:email` → `{ from, replyTo, ownerEmail }`; the environment keeps winning, as it does for keys today |
| — | `NEXT_PUBLIC_SHOP_LOGO_URL`, `NEXT_PUBLIC_RETURN_DAYS`, `NEXT_PUBLIC_RETURN_FEES`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | not written (read if set) | `store_settings:shop` / `:seo`. The logo should become one setting shared with the email brand (Q5) |
| — | `EMAIL_TMP_DIR` | `/tmp/sf-<tag>-email-builder` | stays a developer variable |

## 4. Hardcoded placeholders the owner is told to edit by hand

| # | What | File | Route | Effort |
|---|---|---|---|---|
| 14 | Shipping box, item weight, flat rate, free-shipping threshold, label, currency | `src/lib/shipping/config.ts` | `store_settings:shipping` (already a roadmap item: "Store settings (currency, shipping zones)") | M |
| — | Allowed delivery countries | `CHECKOUT_CONFIG.allowedCountries` | with #3 — done 2026-11-20 | S |
| — | Currency | per product, free text in the product form; `EUR` in shipping config | `store_settings:shop` → `{ currency }`, one per shop (decided 2026-11-04). Needs a migration that checks every product matches before the per-product column goes read-only | M |

## 5. What differs between the store modes

`diff -rq store-modes/generic store-modes/chilli` lists 20 differing files
and one chilli-only file (`Chip.tsx`). Grouped by what would replace them:

| Group | Files | Why they differ | Route |
|---|---|---|---|
| **Schema** | `migrations/0001_init.sql` | Chilli adds `chilli_types`, `products_chilli_types`, `heat_level` on products and brands, their RLS and the views that expose them | Ship the chilli tables to every shop (empty and unused in a generic shop), as a new numbered migration rather than an edit to `0001`. Same principle as product fields: every column exists, settings decide what is used. Existing generic shops gain empty tables; existing chilli shops already have them (the migration is `if not exists`) |
| **Seeds** | `seeds.sql`, `brand-single.sql` | Different example categories, brands, pepper types; `__HEAT_n__` rescaled | Seeds leave the migration series. The wizard offers "add example products" per mode, or nothing |
| **Admin product pages** | `products/page.tsx`, `products/new`, `products/[id]`, `ProductForm.tsx`, `createProduct.ts`, `updateProduct.ts`, `deleteProduct.ts`, `ImageUploader.tsx` | Heat, chilli types and Scoville fields; chilli-type joins on save and delete | One set of files that render the chilli fields when `mode === 'chilli'`. The field catalogue already marks chilli-only fields (`modes: ['chilli']`), so most of the form can be driven by it |
| **Storefront** | `ProductCard`, `ProductArchive`, `ShopArchive`, `ProductExtras`, `BrandCard`, `types.ts`, `Chip.tsx` | Heat meter, heat filter and sort, chilli-type chips | Same: one component, a mode check around the chilli parts. `ShopArchive` already isolates the fetching, so the query adds the chilli join only when enabled |
| **Email starters** | `admin/email/mode.ts` | Different starter templates and accent colour, heat on product blocks | One file with both starter sets, picked by mode |

Messages are already shared: both modes use the same message files (the
`SauceArchive` and `UI.product.featuredSauces` keys carry chilli-era names
but generic wording). Renaming those keys is cosmetic and can ride along.

Everything else in `store-modes/*/admin-components` (orders, discounts,
email designer, settings and the rest) is byte-identical in both modes
today and can move to `shared-assets` as-is (roadmap step 6 in the agreed
plan; no behaviour change). Done 2026-11-19: the 50 identical files now
live in `shared-assets/app/[locale]/admin/`; `store-modes/<mode>/admin-components/`
holds only the 9 that differ.

## 6. Proposed order

Each step keeps both modes generating and passing CI until the generator
is retired.

1. ~~**Move the identical admin files to `shared-assets`**~~ — done
   2026-11-19 (50 files; 9 per mode remain).
2. ~~**A cached settings reader**~~ — done 2026-11-19. `lib/settings/schema.ts`
   (pure: one zod schema and one fallback per key, field-by-field
   resolution, tests) and `lib/settings/store.ts` (`getStoreSetting(key)`
   through `unstable_cache` with tag `store-settings:<key>` and a 5-minute
   safety net, anon key and no cookies; `saveStoreSetting()` validates,
   upserts and calls `updateTag` so the owner sees the change on the next
   page). Any read failure falls back to the generated value and logs why.
3. **Small settings** (S each): ~~shop name (#12)~~ done 2026-11-19 (all 16
   readers, the header included, which showed "🌶️ Store" in every mode;
   `/admin/settings` with a "Shop" section). ~~Checkout address and
   countries (#3)~~ done 2026-11-20: `store_settings:checkout`, the
   session route, the checkout page and form, and the structured data
   (`shippingPolicy()` is async and `shopReturnPolicy()` replaces reading
   the config in the pages), with a country picker on `/admin/settings`.
   Fallbacks can now read the generated files as well as the environment
   (`lib/settings/generated.ts`), which the remaining two need.
   ~~Single/multi brand (#6)~~ done 2026-11-20: `shop.brands` with the
   environment variable as its fallback, the four product actions ask
   `getBrandMode()`, and a radio pair in the Shop section; switching to
   single in a shop with no brands creates one named after the shop
   (slug `house-brand`), existing products keep their brands.
   ~~Sign-in and MFA (#7, #8)~~ done 2026-11-20: `store_settings:auth`,
   the admin guard, and the sign-in and sign-up pages moved out of the
   generator into `shared-assets` (a server page reading the setting plus
   a client form each). Turning the factor off goes through
   `ensureShopOwner()`, which refuses a session that has not passed it,
   and unenrols the authenticator so the two agree; `0013` makes the
   database insist on the same thing, since the row is reachable over the
   Data API. Step 3 is complete.
   Each one: a schema and fallback in `lib/settings/schema.ts`, a section
   on `/admin/settings`, readers switched to `getStoreSetting()`.
4. **Product fields and heat scale** (M). ~~Product fields~~ done
   2026-11-20: `store_settings:product_fields`, the catalogue's `*From`
   helpers (the wrappers that read the generated keys are gone, so the
   setting is the only source), the four product actions and the four
   product pages reading it, the two `ProductForm`s taking the grouped
   fields as a prop, and a picker on `/admin/settings`. No migration, as
   expected: every column already exists.
   The heat scale is what is left, and it waits on Q4, whose answer
   changed once the column type and the view that depends on it were
   looked at. Shape of the work: `lib/products/heat.ts` loses its
   module-level scale the way the catalogue lost its key list (everything
   through the `*On` functions), the scale is read by the server parents
   and passed into `ProductCard`, `ProductArchive`, `ProductExtras`,
   `BrandCard`, `ProductFieldInput` and the chilli email starters, the
   generator stops rescaling `__HEAT_n__` seeds, and `/admin/settings`
   gains the scale, the display choice and the word bands.
5. **Shipping and currency** (M). The currency migration is the risky one;
   it gets its own session and a dry-run query first. Includes a home
   country setting (decided 2026-11-20): the one country the return-policy
   markup names, instead of the alphabetically first the shop delivers to,
   and later the returns address.
6. **Chilli as a toggle** (L, two or three sessions). The chilli-tables
   migration, then the admin pages, then the storefront, then the starters.
   Only after this does `--mode` stop meaning "copy a different directory".
7. **Languages at runtime** (M). `src/proxy.ts` reads the locales through
   the same cached reader (Q3).
8. **Then** section 0's later items: the deploy button, the first-run wizard
   (which is mostly a guided walk through the settings above). No upgrade
   path for previously generated shops: there are none to upgrade.

## 7. Questions

Answered 2026-11-19: Q1, Q2, Q3, Q6. Still open: Q4, Q5 (none blocks the
first steps).

- **Q1. Where do a shop's generated choices go?** *Answered:* nothing is
  copied into the database; the settings reader falls back to the
  generated files and environment variables until the owner saves a
  setting in the admin. No one-off migration script. (There are no
  previously generated shops in use, see the top of this document.)
- **Q2. Admin layout.** *Answered:* one `/admin/settings` page with a
  section per area. Email keeps its own settings under `/admin/email/settings`.
- **Q3. Locales at the edge.** *Answered:* a cached database read. The
  proxy reads `store_settings:languages` through Next's data cache, tagged
  and revalidated when the owner saves, so there is no Supabase call per
  request and no Vercel token. (Rejected: an environment variable written
  through the Vercel API.)
- **Q4. Heat storage.** Heat is stored on the shop's chosen scale today
  (seeds rescaled at generation). A runtime scale change would then need a
  data migration. The proposal was: store 0–10 always, scale at display.
  *Looked at properly on 2026-11-20, and it is not free.* Two facts
  decide it: `products.heat_level` and `chilli_types.heat_level` are
  `integer`, and `products_public` selects `heat_level`, so a type change
  means dropping and recreating that view inside a migration that must
  also no-op on generic shops, which have no such column. The options:
  - **(a) canonical 0–10 as integer.** No migration. But a shop on the
    generator's 20-point scale then has only 11 distinct values, so half
    its scale is decorative — it would show 0/20, 2/20, 4/20 and nothing
    between.
  - **(b) canonical 0–10 as `numeric(4,1)`.** Keeps every scale exact
    (a 20-point scale lands on 0.5 steps) and no scale change ever touches
    a row, which is what Q4 wanted. Costs the column-type migration and
    the view recreation above.
  - **(c) keep storing on the shop's scale, and rescale the rows when the
    owner changes the scale** — one `update` over `products` and
    `chilli_types` inside the save action, under the owner's RLS.
    No migration, no view churn, no reinterpretation of existing values,
    and the display code stays exactly as it is. The loss is only at the
    moment of a rescale, which is inherent to rescaling.

  *Recommendation (revised after looking): (c).* Scale changes are rare
  and one-off, the rounding cost is the same as (b) at the moment it
  happens, and it avoids both the type migration and the view rebuild.
  **Needs a decision before the heat half of step 4 is written.**
- **Q5. One logo.** The email brand has a logo; the SEO structured data
  (`lib/seo/store.ts`) reads `NEXT_PUBLIC_SHOP_LOGO_URL`; the site header
  shows only the name. Merge into one shop setting that the email brand,
  the structured data and the header all use?
- **Q6. Chilli tables in generic shops.** *Answered: yes.* Every shop gets
  the chilli tables, empty and unused in a generic shop, in exchange for
  one schema.
- **Q7. Delivery countries vs the payment provider.** *Decided 2026-11-20:*
  the picker stays the full ISO list for now, with Stripe's own refusal at
  session creation as the guard. Once the payment adapters exist (ROADMAP
  section 4), the picker and the checkout-setting validation must follow
  the active provider's supported countries, so a shop can never offer a
  country its provider refuses or one under sanctions.

## 8. Not in scope here

The Docker path, payment adapters, and the Node CLI replacing the heredocs
(ROADMAP section 4) are independent of this plan. The Node CLI becomes much
smaller once the choices above are settings, which is an argument for doing
this first.
