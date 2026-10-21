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
- **Database:** profiles, addresses, brands, categories, products and cart
  items, with row-level security and seed data
- **Languages:** any set of locales via `next-intl`, with RTL layout for Arabic
- **Two store modes:**
  - `generic`: products, brands and categories
  - `chilli`: adds heat levels and chilli types, for hot-sauce shops
- **Security defaults:** customers can't change their own role, carts are
  server-only, and nobody becomes an admin automatically

**Starting points you finish yourself**

- **Storefront pages:** `/shop`, `/cart` and `/checkout` are placeholders
  (checkout already requires sign-in). Storefront components (product
  listing with filters, product card, brand showcase) are copied into
  `src/components/store/` for you to wire in.
- **Stripe:** `POST /api/checkout/session` creates a Checkout session from the
  cart, using database prices. There's no add-to-cart button, success page or
  webhook yet, so orders aren't recorded.

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
create-next-commerce-template-ssr.sh <name> [default-locale] [locales] [--mode=generic|chilli]
```

| Argument | Default | Meaning |
| --- | --- | --- |
| `name` | `next-commerce-template` | Folder and package name for the new shop |
| `default-locale` | `en` | Language used at `/` |
| `locales` | `en,de,tr,ar` | Comma-separated supported languages |
| `--mode` | `chilli` | Store mode from `store-modes/` |

The script also asks whether the shop sells a **single** brand or is a
**multi**-brand marketplace, which decides whether the admin product form shows
a brand selector.

`extend-commerce-template.sh [--mode=…]` runs inside an existing generated shop
and adds the profile API and Stripe checkout session route, plus the latest
store and admin components for that mode. It doesn't change migrations or ask
for keys.

## Security model

- **Roles:** a database trigger rejects any attempt by a customer to set or
  change `profiles.role`. Owners are promoted from the SQL editor.
- **Carts:** `cart_items` has no public access. Checkout reads it on the server
  with the service-role key, and prices always come from the database, never
  from the browser.
- **Secrets:** the generator creates a random `NEXTAUTH_SECRET`. Keep
  `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` server-side only;
  `.env.local` is already gitignored.

## Repository layout

```
create-next-commerce-template-ssr.sh   scaffolds a new shop
extend-commerce-template.sh            adds checkout + profile API to a shop
store-modes/<mode>/                    schema, seeds, storefront and admin components
shared-assets/lib/                     helpers copied into every shop
shared-assets/modules/                 experimental feature modules (not used by the scripts yet)
```

## Tech stack

Next.js 16 (App Router, React 19), TypeScript, Tailwind CSS 4, Supabase
(Postgres, Auth, Storage), next-intl, Stripe, pnpm.

## License

[MIT](LICENSE) © 2025 Nathan Austin
