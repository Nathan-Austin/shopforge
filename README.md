# shopforge

Generate your own multilingual online shop with **Next.js 16, Supabase,
Tailwind CSS 4 and Stripe**, ready to deploy on Vercel.

One command scaffolds the foundation of a store: customer accounts, an admin
panel for managing products, the database schema with row-level security, a
server-side Stripe checkout API, and multilingual routing with right-to-left
support for languages such as Arabic.

## What you get

**Ready to use**

- **Accounts:** email and password sign-up, sign-in and password reset
  (Supabase Auth); a profile row is created for every new user
- **Admin panel** at `/<locale>/admin`, for the shop owner only: list, create,
  edit and delete products, with image uploads to Supabase Storage
- **Database:** profiles, addresses, brands, categories, products, cart
  items and orders, with row-level security and seed data
- **Languages:** any set of locales via `next-intl`, with RTL layout for Arabic
- **Product fields you choose:** pick from ~32 fields at generation time
  (headline, SKU, stock, compare-at price, net content, allergens, nutrition,
  tags, SEO and more). Every column exists in the database either way, so
  turning one on later is a config change, not a migration
- **Two store modes:**
  - `generic`: products, brands and categories
  - `chilli`: adds heat levels and chilli types, for hot-sauce shops. Heat is
    stored as a number on a scale you choose (0-5, 0-10, 0-20 or your own),
    and the words for it — mild, medium, hot, and any others you want — are
    display bands over that number, all optional
- **Cart and checkout:** add to cart with size/colour variants, stock limits
  enforced server-side, a `/cart` page and a live header count. `/checkout`
  works signed in or as a guest and hands over to Stripe; the webhook records
  the order, decrements stock and empties the cart once payment is confirmed.
  Success and cancel pages, with the success page showing the order and
  updating itself while the webhook catches up
- **Orders:** `orders` and `order_items` snapshot names, prices and the
  delivery address at the time of payment. Customers see their own orders,
  the shop owner sees all. A guest can create an account afterwards and, once
  their email is confirmed, their orders are attached to it
- **Delivery address, your way:** `--shipping=form` (default) asks for it on
  your checkout page; `--shipping=stripe` leaves it to Stripe's payment page,
  for owners who would rather not handle it at all
- **Security defaults:** customers can't change their own role, carts are
  server-only, supplier fields aren't published, and nobody becomes an admin
  automatically

**Starting points you finish yourself**

- **Storefront pages:** `/shop` is a plain grid. Storefront components
  (product listing with filters, product card, brand showcase) are copied
  into `src/components/store/` for you to wire in.
- **Orders after the sale:** there is no customer order history page, admin
  orders view or confirmation email yet. The data is all there in `orders`.
- **Shipping:** one flat rate with a free-shipping threshold, set with
  placeholder values in `src/lib/shipping/config.ts`. With `--shipping=stripe`
  the countries Stripe may ship to are a placeholder list in
  `src/lib/checkout/config.ts`.

## Requirements

- Node.js 20 or newer and [pnpm](https://pnpm.io) (`corepack enable pnpm`)
- A free [Supabase](https://supabase.com) project
- A [Stripe](https://stripe.com) account (test keys are fine to start)
- A [Vercel](https://vercel.com) account to deploy (optional)

## Quick start

```bash
git clone https://github.com/Nathan-Austin/shopforge.git
cd ~/projects          # wherever you want your shop to live, outside shopforge
~/path/to/shopforge/create-next-commerce-template-ssr.sh my-shop en "en,de,ar" --mode=generic
cd my-shop
~/path/to/shopforge/extend-commerce-template.sh --mode=generic
pnpm dev
```

The first script asks for your Supabase project URL, anon key, service-role
key and project ref, then pushes the database schema. The second adds the
profile API and Stripe checkout. Both create files in the current folder and
find their templates relative to their own location.

Then:

1. In the Supabase dashboard, create a **public** storage bucket named
   `product-images`. Its access policies are already applied.
2. Put your Stripe secret key in `.env.local` (`STRIPE_SECRET_KEY`).
3. Sign up at `http://localhost:3000/en/auth/sign-up` and make yourself the
   shop owner (below).

The full walkthrough, including deployment, is in [SETUP_GUIDE.md](SETUP_GUIDE.md).

## Make yourself the shop owner

New accounts are always created as `customer`. Nobody is promoted
automatically, so a shop that goes live before you register can't be claimed by
a stranger. After signing up, run this in the Supabase SQL editor:

```sql
update public.profiles set role = 'shop_owner'
 where id = (select id from auth.users where email = 'you@example.com');
```

The admin panel is then available at `/en/admin`.

## Script options

```
create-next-commerce-template-ssr.sh <name> [default-locale] [locales] [--mode=generic|chilli] [--skip-supabase]
```

| Argument | Default | Meaning |
| --- | --- | --- |
| `name` | `next-commerce-template` | Folder and package name for the new shop |
| `default-locale` | `en` | Language used at `/` |
| `locales` | `en,de,tr,ar` | Comma-separated supported languages |
| `--mode` | `chilli` | Store mode from `store-modes/` |
| `--skip-supabase` | off | Don't run the Supabase CLI or ask for keys; write placeholder values to `.env.local` and leave the migrations in `supabase/migrations/` for a later `supabase db push`. For tests and CI |

The script also asks:

- whether the shop sells a **single** brand or is a **multi**-brand
  marketplace, which decides whether the admin product form shows a brand
  selector
- **which product fields** the admin panel should manage, as a grouped list
  where `0` selects everything and Enter takes the recommended set
- for `chilli` shops, the **heat scale**: its maximum, which words to use and
  how heat should appear in the shop (word and number, word only, number only
  or chilli icons)

To skip the questions, preset `SHOPFORGE_PRODUCT_FIELDS` (`all`,
`recommended`, or a comma-separated list of field keys), `SHOPFORGE_HEAT_MAX`,
`SHOPFORGE_HEAT_BANDS` (`Mild:3,Hot:10`) and `SHOPFORGE_HEAT_DISPLAY`. The
answers end up in `src/lib/products/config.ts`, which you can edit afterwards.

`extend-commerce-template.sh [--mode=…] [--shipping=form|stripe]` runs inside
an existing generated shop and adds the profile API, the Stripe checkout
session route, the webhook and the checkout pages, plus the latest store and
admin components for that mode. It doesn't change migrations or ask for keys.

`--shipping` decides who asks the customer for the delivery address:

| Value | Where the address is typed | Why you might pick it |
| --- | --- | --- |
| `form` (default) | Your `/checkout` page, then Stripe for the card | One page fewer for the customer, and the form is yours to style |
| `stripe` | Stripe's payment page, alongside the card | Nothing personal is posted to your server before payment, Stripe validates the address, and some owners prefer the customer to see they are typing into Stripe |

Either way the webhook stores the same address on the order. The choice is
written to `src/lib/checkout/config.ts`, which you can edit later.

## Security model

- **Roles:** a database trigger rejects any attempt by a customer to set or
  change `profiles.role`. Owners are promoted from the SQL editor.
- **Carts:** the cart id lives in an httpOnly `shop_cart_session` cookie and is
  read on the server by every action, so it is never accepted from a request
  body and nobody can act on someone else's cart. `cart_items` has no public
  access; all reads go through the service-role key. Prices, stock and variants
  always come from the database, never from the browser. Signing out clears the
  cookie, so a cart doesn't carry over on a shared machine.
- **Products:** the table isn't world-readable. The storefront reads the
  `products_public` view, which excludes supplier fields (`cost_price_cents`,
  `sku`, `barcode`) and unpublished rows; only the shop owner reads the table.
- **Payments:** the Stripe webhook verifies the signature before acting, and
  records each event id so a retry can't decrement stock twice. Stock is only
  decremented once Stripe reports the payment as paid.
- **Orders:** written only by the webhook with the service-role key; the Data
  API can't insert or change them. Customers read their own, the owner reads
  all. A guest order has no `user_id` and is attached to an account only when
  that account's email is confirmed, so registering with someone else's
  address reveals nothing. The success page finds the order by the Stripe
  session id, which only the paying browser is given.
- **Secrets:** the generator creates a random `NEXTAUTH_SECRET`. Keep
  `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` server-side only;
  `.env.local` is already gitignored.

## Repository layout

```
create-next-commerce-template-ssr.sh   scaffolds a new shop
extend-commerce-template.sh            adds checkout, webhook + profile API to a shop
store-modes/<mode>/                    schema, seeds, storefront and admin components
shared-assets/lib/                     helpers copied into every shop
shared-assets/components/              components copied into every shop
lib/product-fields.py                  reads the catalogue for the field picker
test/generate-and-check.sh             generates a store and runs install, tsc, lint, build
```

## Testing the generator

```bash
test/generate-and-check.sh --mode=generic
test/generate-and-check.sh --mode=chilli --shipping=stripe
```

This generates `test-generic/` with placeholder keys (no Supabase project
needed), then runs `pnpm install --frozen-lockfile`, `tsc --noEmit`,
`pnpm lint`, `pnpm test` and `pnpm build`, the same checks a Vercel deploy
performs. `--shipping` is passed through to the extend script so both
address modes can be checked. Add `--keep` to inspect the generated store
afterwards.

Generated shops come with [Vitest](https://vitest.dev) and unit tests for
the logic that ships with them — the heat scale, product field parsing,
shipping and price formatting. Run them in your shop with `pnpm test`, or
`pnpm test:watch` while you work.

## Roadmap

Planned work is in [ROADMAP.md](ROADMAP.md).

## Tech stack

Next.js 16 (App Router, React 19), TypeScript, Tailwind CSS 4, Supabase
(Postgres, Auth, Storage), next-intl, Stripe, pnpm.

## License

[MIT](LICENSE) © 2025 Nathan Austin
