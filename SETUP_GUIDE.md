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

The script then asks a few questions, two of which affect Supabase settings:

- **Customer sign-in.** *Password* is the familiar flow. *Email code* sends a
  six-digit code instead; there is no password and the first code creates the
  account. If you pick it, open **Authentication → Email Templates → Magic
  Link** in Supabase and replace `{{ .ConfirmationURL }}` with
  `{{ .Token }}`, so the email carries the code rather than a link. Links are
  deliberately avoided: Microsoft and other mail scanners open them before the
  customer does, and a used link stops working.
- **Admin two-factor.** On by default. The owner needs a code from an
  authenticator app to use `/admin`. This uses Supabase's TOTP factor, which
  is enabled under **Authentication → Multi-Factor** for new projects; check
  it is on.

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
NEXT_PUBLIC_SHOP_NAME=My Shop        # shown in the confirmation email
RESEND_API_KEY=re_…                  # optional, see "Order confirmation emails"
EMAIL_FROM=My Shop <orders@myshop.com>   # optional, must be a verified sender
EMAIL_REPLY_TO=hello@myshop.com      # optional, where replies go
SHOP_OWNER_EMAIL=you@myshop.com      # optional, BCC on receipts, CC on refund emails
NEXTAUTH_SECRET=…                    # generated; signs links, keep it secret
```

`.env.local` is gitignored. Never commit it.

### Order confirmation emails

Optional. Leave `RESEND_API_KEY` and `EMAIL_FROM` empty and the shop works
exactly as before, sending nothing. Set both and the webhook emails the
customer a receipt as soon as the payment clears.

1. Create a free account at [resend.com](https://resend.com) and an API key.
2. Decide which address the email comes from. Until a domain is verified,
   Resend only lets you send from its sandbox sender, and only to your own
   address — enough to test the flow end to end before you have a domain.
3. When your shop has a live domain, add it in Resend under **Domains** and
   create the DNS records it shows you (a DKIM record, and SPF if you don't
   already send mail from that domain). Verification usually takes minutes,
   but DNS can take longer to propagate. Then set
   `EMAIL_FROM="My Shop <orders@yourdomain.com>"`.
4. For a staging site, either add the staging domain in Resend as a second
   domain, or point staging at the same verified sending domain — the from
   address does not have to match the site's own URL. Keep a separate API
   key per environment so you can revoke one without touching the other.

The customer's receipt lists the items, the totals and the delivery address.
`SHOP_OWNER_EMAIL` blind-copies you on every one. Each order records
`confirmation_sent_at`, so a retried webhook never emails twice and you can
find orders whose email never went out:

```sql
select id, email, created_at from public.orders
 where confirmation_sent_at is null and status = 'paid';
```

A provider outage never fails the webhook: the payment and the order are
already real, so the order is kept and the failure is logged.

### Discount codes

`/<locale>/admin/discounts` creates promo codes. Three kinds:

- **Percentage off** and **amount off** are created in Stripe as a coupon
  plus a promotion code with the same restrictions, and Stripe applies them
  to the checkout session, so Stripe's receipts and reports agree with the
  shop's. Deleting such a code deletes the coupon; retiring it deactivates
  the promotion code.
- **Free shipping** has no Stripe counterpart (coupons cannot zero a
  shipping rate); the shop sets the shipping rate to zero itself.

Codes can carry a minimum order, a valid-from/until window and a maximum
number of uses. Customers enter a code on the cart or checkout page; it is
checked then and again when they pay, and every refusal says why (expired,
below the minimum, and so on). The order records the code and the amount in
`orders.discount_code` / `discount_cents`, and the receipt shows it.

Amount codes and minimums need a currency; the form defaults to the one your
products use. Codes are per order, not per customer.

### Shipping emails

Setting an order's status to **Shipped** on `/<locale>/admin/orders` emails
the customer once, in the language they checked out in, with whatever
tracking you entered next to the status: carrier, tracking number and an
optional link. Leave the link empty for DHL, DPD, GLS, Hermes, UPS, FedEx,
USPS, Royal Mail, An Post, La Poste, PostNL, PTT and Aramex and the carrier's
own tracking page is used.

The email goes at most once per order: `orders.shipping_notified_at` is set
when it is sent, and changing the status back and forth afterwards does not
email again. If the first send fails (provider down, email not configured)
nothing is recorded, so the next time the order arrives at Shipped it tries
again, and the orders page shows "Customer not emailed" with a button to
send it by hand. The owner is not copied on shipping emails.

### Refunds

Open an order from `/<locale>/admin/orders` and use the refund form. You can
refund the rest of the order, particular items and quantities, a percentage
of the total, or an amount you type, never more than what is left. The
button stays disabled until you type `REFUND`. The money goes back through
Stripe to the card the customer paid with, using the order's payment
intent, so refunds work for guest orders too.

Every attempt is a row in `public.order_refunds` with the Stripe refund id,
and `orders.refunded_cents` tracks the running total; the order's status
becomes `refunded` only once the whole amount has gone back. The customer
gets an email with the amount, the items if any, and your note, and
`SHOP_OWNER_EMAIL` is visibly copied so the team can see it. With email not
configured the refund still happens and the form says the customer was not
notified.

If a row stays `pending`, the app stopped between reserving the amount and
hearing back from Stripe. Check the payment in the Stripe dashboard before
trying again; the pending row stops counting against the order after an
hour, and the Stripe call is idempotent per row, so a retry of the same
attempt cannot refund twice.

Refunds made directly in the Stripe dashboard are not reflected in the shop.

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

1. Open `http://localhost:3000/en/auth/sign-up` and create your account with
   a password. If customers sign in with email codes, use
   `http://localhost:3000/en/auth/sign-in?method=password` from then on: the
   owner always has a password.
2. Promote yourself in the Supabase **SQL editor**:

   ```sql
   update public.profiles set role = 'shop_owner'
    where id = (select id from auth.users where email = 'you@example.com');
   ```

3. Open `http://localhost:3000/en/admin`. With admin two-factor on you are
   sent to `/en/auth/mfa` first: scan the QR code with an authenticator app
   and enter the code it shows. Each new session asks for a code again.
4. Add your first product. Paid orders appear under **Orders** in the admin,
   where you can mark them shipped, cancelled or refunded.

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
- [ ] After promotion, `/en/admin` asks for an authenticator code (if on),
      then opens; for other accounts it redirects away
- [ ] `/en/account/orders` lists the signed-in customer's orders and nothing
      else; `/en/admin/orders` lists every order and the status can be changed
- [ ] Creating a product with an image works, and the image loads
- [ ] `/en/checkout` opens signed out (guest checkout) and prefills your email
      when signed in
- [ ] A test payment lands in `public.orders` with its `order_items`, and the
      success page shows it within a few seconds
- [ ] If email is configured, the receipt arrives and the order's
      `confirmation_sent_at` is set
- [ ] Every configured language loads (e.g. `/en`, `/de`, `/ar`), and `/ar` is
      right-to-left
- [ ] The Vercel build log shows no errors

## Troubleshooting

**`supabase link` fails or can't find the project.** The CLI is logged in to a
Supabase account that can't see this project. Run `npx supabase login` with the
account that owns it, then re-run the script.

**You lost the phone with the admin authenticator.** There are no recovery
codes yet. In the Supabase dashboard open **Authentication → Users**, find
your account, and delete its MFA factor. The next visit to `/admin` starts
enrolment again, so have the new phone ready. Only someone with dashboard
access can do this, which is why it is a safe recovery path.

**A customer says the receipt never arrived.** Check the order first:

```sql
select id, email, confirmation_sent_at from public.orders
 where stripe_session_id = 'cs_…';
```

A null `confirmation_sent_at` means the send failed or email isn't
configured; the server log has the reason. Failed sends are not retried, so
resend it by hand from Resend or your mail client. A timestamp means Resend
accepted it, and the delivery log in the Resend dashboard is the next place
to look.

**Customers get a sign-in link instead of a code.** The shop was generated
with email-code sign-in but the Supabase **Magic Link** email template still
uses `{{ .ConfirmationURL }}`. Change it to `{{ .Token }}`.

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
