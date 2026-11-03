# Setup guide

A step-by-step walkthrough for creating your own shop with shopforge, from an
empty Supabase project to a deployment on Vercel. For a short overview, see the
[README](README.md).

1. [Install the tools](#1-install-the-tools)
2. [Create a Supabase project](#2-create-a-supabase-project)
3. [Generate the shop](#3-generate-the-shop)
4. [Add checkout and the profile API](#4-add-checkout-and-the-profile-api)
5. [Create the storage bucket](#5-create-the-storage-bucket)
6. [Configure environment variables](#6-configure-environment-variables)
7. [Run locally and become the shop owner](#7-run-locally-and-become-the-shop-owner)
8. [Push to GitHub](#8-push-to-github)
9. [Deploy to Vercel](#9-deploy-to-vercel)
10. [Check the deployment](#10-check-the-deployment)
11. [Troubleshooting](#troubleshooting)

---

## 1. Install the tools

- **Node.js 20 or newer:** [nodejs.org](https://nodejs.org)
- **pnpm:** `corepack enable pnpm`
- **Supabase CLI:** `npm i -g supabase`, or let the script use `npx supabase`
- **Git**

Clone shopforge somewhere permanent. Your shop is generated into a separate
folder, so it gets its own repository:

```bash
git clone https://github.com/Nathan-Austin/shopforge.git ~/shopforge
mkdir -p ~/projects && cd ~/projects
```

## 2. Create a Supabase project

At [supabase.com/dashboard](https://supabase.com/dashboard), create a new
project, then collect these from **Project Settings**:

| Value | Where | Example |
| --- | --- | --- |
| Project ref | General | `abcd1234xyz` |
| Project URL | Data API | `https://abcd1234xyz.supabase.co` |
| Anon (public) key | API Keys | `eyJ…` |
| Service-role key | API Keys | `eyJ…`; keep it secret, server-side only |

Then check **Authentication → Sign In / Providers → Email** and make sure
**Confirm email** is on. It is on by default for new projects. The shop
relies on it: a guest's orders are attached to an account only after the
account's email is confirmed, so with confirmation off anyone could sign up
with someone else's address and read their orders. Leave it on.

## 3. Generate the shop

From `~/projects`:

```bash
~/shopforge/create-next-commerce-template-ssr.sh my-shop en "en,de,ar" --mode=generic
```

- `my-shop`: folder and package name
- `en`: default language
- `"en,de,ar"`: supported languages (Arabic gets a right-to-left layout)
- `--mode`: `generic`, or `chilli` for hot-sauce shops (adds heat levels and
  chilli types); `chilli` is the default if you leave it out

The script will:

1. Create the Next.js app and install dependencies
2. Ask for the four Supabase values from step 2, whether the shop sells a
   **single** brand or is a **multi**-brand marketplace, which product fields
   the admin panel should manage, and — for `chilli` — the heat scale and how
   heat should read to customers
3. Log in to the Supabase CLI if needed and link the project
4. Push the schema, seed data and storage policies as migrations
5. Copy in the store and admin components for the chosen mode
6. Write `.env.local`, including a random `NEXTAUTH_SECRET`
7. Make the first git commit in `my-shop`

## 4. Add checkout and the profile API

```bash
cd my-shop
~/shopforge/extend-commerce-template.sh --mode=generic
# or, to have Stripe's payment page collect the delivery address:
~/shopforge/extend-commerce-template.sh --mode=generic --shipping=stripe
```

Use the same `--mode` as in step 3. This adds:

- `POST /api/profile`, which makes sure the signed-in user has a profile row
- `POST /api/checkout/session`, which builds a Stripe Checkout session from the
  cart on the server, using prices from the database
- `POST /api/webhooks/stripe`, which records the order, decrements stock and
  empties the cart once Stripe confirms payment
- `/checkout`, `/checkout/success` and `/checkout/cancel` pages

`--shipping` picks who asks for the delivery address. `form` (the default)
asks on your checkout page; `stripe` asks only for an email there and lets
Stripe's payment page collect the address, which suits owners who would
rather no personal details reach their server before payment. If you choose
`stripe`, set the countries you ship to in `src/lib/checkout/config.ts`.

It doesn't touch migrations or ask for keys. Re-running it overwrites the
files it adds, including the copied store and admin components, so commit any
changes to those first.

## 5. Create the storage bucket

In the Supabase dashboard, go to **Storage → New bucket** and create a
**public** bucket named `product-images`. Its upload and read policies were
already applied in step 3. The admin panel stores product images here.

## 6. Configure environment variables

`.env.local` was written in step 3. Add your Stripe keys:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://abcd1234xyz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
SUPABASE_SERVICE_ROLE_KEY=…          # server only
SUPABASE_PROJECT_REF=abcd1234xyz
NEXT_PUBLIC_STORE_MODE=single        # or multi
NEXT_PUBLIC_SITE_URL=http://localhost:3000
STRIPE_SECRET_KEY=sk_test_…          # from dashboard.stripe.com → Developers → API keys
STRIPE_WEBHOOK_SECRET=whsec_…        # from the webhook you create below
NEXTAUTH_SECRET=…                    # generated; signs links, keep it secret
```

`.env.local` is gitignored. Never commit it.

### The Stripe webhook

Payment only counts when Stripe says so, so the order is recorded, stock is
decremented and the cart is emptied by the webhook, not by the browser
returning from checkout. Without it, payments still succeed but no order is
written, nothing is deducted and carts stay full.

In the Stripe dashboard, add an endpoint at
`https://your-site/api/webhooks/stripe` subscribed to
`checkout.session.completed`, and copy its signing secret into
`STRIPE_WEBHOOK_SECRET`.

Locally, forward events instead:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

## 7. Run locally and become the shop owner

```bash
pnpm dev
```

1. Open `http://localhost:3000/en/auth/sign-up` and create your account.
2. Promote yourself in the Supabase **SQL editor**:

   ```sql
   update public.profiles set role = 'shop_owner'
    where id = (select id from auth.users where email = 'you@example.com');
   ```

3. Open `http://localhost:3000/en/admin` and add your first product.

New accounts are always customers, and customers can't change their own role,
so only the SQL editor (or the service-role key) can create a shop owner.

## 8. Push to GitHub

Create an empty repository on GitHub (no README), then from `my-shop`:

```bash
git remote add origin git@github.com:<your-username>/my-shop.git
git branch -M main
git push -u origin main
```

## 9. Deploy to Vercel

1. In [Vercel](https://vercel.com), choose **Add New → Project** and import the
   repository.
2. Add the environment variables from `.env.local`. Set `NEXT_PUBLIC_SITE_URL`
   to your Vercel or custom domain, e.g. `https://my-shop.vercel.app`.
3. Click **Deploy**.
4. In Supabase, go to **Authentication → URL Configuration** and set the
   **Site URL** to the same domain, so sign-up and password-reset emails link to
   your live shop.

## 10. Check the deployment

- [ ] Sign-up works and creates a row in `public.profiles` with role `customer`
- [ ] After promotion, `/en/admin` opens; for other accounts it redirects away
- [ ] Creating a product with an image works, and the image loads
- [ ] `/en/checkout` opens signed out (guest checkout) and prefills your email
      when signed in
- [ ] A test payment lands in `public.orders` with its `order_items`, and the
      success page shows it within a few seconds
- [ ] Every configured language loads (e.g. `/en`, `/de`, `/ar`), and `/ar` is
      right-to-left
- [ ] The Vercel build log shows no errors

## Troubleshooting

**`supabase link` fails or can't find the project.** The CLI is logged in to a
Supabase account that can't see this project. Run `npx supabase login` with the
account that owns it, then re-run the script.

**pnpm stops with "Ignored build scripts" (`ERR_PNPM_IGNORED_BUILDS`).** The
generator already approves the build scripts it knows about in the shop's
`pnpm-workspace.yaml` (`allowBuilds`). If a dependency you add later triggers
this, run `pnpm approve-builds` in the shop, or add the package to
`allowBuilds` yourself, then run `pnpm install` again.

**Image uploads fail.** Check that the `product-images` bucket from step 5
exists and is public, and that you're signed in as the shop owner.

**Changing the schema later.** Add a new file under `supabase/migrations/` in
your shop and run `npx supabase db push`. The files in shopforge's
`store-modes/` only affect shops generated afterwards.
