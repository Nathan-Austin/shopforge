# 🧭 Next.js + Supabase + Vercel Multi-Client Setup Guide

A repeatable workflow for building new e-commerce websites using **Next.js 16 + Supabase SSR + TailwindCSS 4 + Vercel**, with separate accounts per project to stay on the free tiers.

---

## 📋 Table of Contents

1. [Workspace Setup](#%EF%B8%8F-workspace-setup)
2. [Create New Project Accounts](#1%EF%B8%8F⃣-create-new-project-accounts)
3. [Create Supabase Project](#2%EF%B8%8F⃣-create-supabase-project)
4. [Store Modes](#store-modes)
5. [Scaffold the Project](#3%EF%B8%8F⃣-scaffold-the-project)
6. [Configure Environment Variables](#4%EF%B8%8F⃣-configure-environment-variables)
7. [Link Supabase Project](#5%EF%B8%8F⃣-link-supabase-project)
8. [Extend the Template](#6%EF%B8%8F⃣-extend-the-template)
9. [Supabase Automation](#supabase-automation)
10. [Connect to GitHub](#8%EF%B8%8F⃣-connect-to-github)
11. [Deploy to Vercel](#9%EF%B8%8F⃣-deploy-to-vercel)
12. [Verify Deployment](#%EF%B8%8F-verify-deployment)

---

## ⚙️ Workspace Setup

Keep the generator and the generated stores in separate folders, so client
projects never end up inside the shopforge repo:

```
~/shopforge/                 # this repo (the generator)
├── create-next-commerce-template-ssr.sh
├── extend-commerce-template.sh
├── store-modes/
└── shared-assets/

~/websites/                  # generated client stores, each its own repo
├── client1-store/
├── client2-shop/
└── ...
```

Make both scripts executable once:

```bash
chmod +x create-next-commerce-template-ssr.sh extend-commerce-template.sh
```

---

## 1️⃣ Create New Project Accounts

For each new client or brand:

1. **Create a new Gmail** (e.g., `clientname.dev@gmail.com`)
2. **Create a new GitHub account** using that email
   - Username format: `clientname-sys`
3. **Create a new Supabase project** (log in with that GitHub)
4. **Create a new Vercel account** (same GitHub)

💡 **Why?** This isolates billing and keeps each project within free-tier limits.

---

## 2️⃣ Create Supabase Project

At [app.supabase.com](https://app.supabase.com):

1. Click **New Project**
2. Note these values:
   - `project_ref` → e.g., `abcd1234xyz`
   - Project URL → `https://abcd1234xyz.supabase.co`
   - `anon key`
   - `service_role key`

---

## Store Modes

All scaffolding assets live under `store-modes/<mode>/`:

```
store-modes/
  chilli/
    store-components/
    admin-components/
    schema.sql
    seeds.sql
    brand-single.sql
  generic/
    ...
```

- `chilli` (default) includes chilli types, heat levels, and the spicy storefront/admin packs you’ve already been using.
- `generic` is a clean catalogue (products/brands/categories only) with a simplified admin UI.

Each mode ships its own schema + seed files, so the generator can push the right database objects and copy the matching React packs automatically.

---

## 3️⃣ Scaffold the Project

From `~/websites` (the scripts find their own assets, and the store is created in the current folder):

```bash
~/shopforge/create-next-commerce-template-ssr.sh clientname-store en "en,de,tr,ar"      # default chilli mode
~/shopforge/create-next-commerce-template-ssr.sh clientname-store en --mode=generic    # generic mode
cd clientname-store
```

**Arguments:**
- `clientname-store` - Project name
- `en` - Default locale
- `"en,de,tr,ar"` - Comma-separated list of supported locales
- `--mode=<chilli|generic>` - Optional flag; default is `chilli`

What the script now does:
- Scaffolds the Next.js app via `pnpm create next-app`
- Prompts once for Supabase URL / anon / service keys (writes `.env.local`)
- Links the Supabase project and runs `supabase db push` using the mode’s `schema.sql`
- Seeds categories/brands/etc. via the mode’s `seeds.sql` (plus default brand for single-store setups)
- Creates the `product-images` bucket + storage policies
- Copies the matching `store-components` + `admin-components` pack into the app

---

## 4️⃣ Configure Environment Variables

The scaffolder writes `.env.local` using the values you just entered. Open the file and fill in any remaining app secrets (payments, site URL, etc.):

```bash
cat > .env.local <<'EOF'
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# App base URL
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Payment providers (use sandbox/test keys for dev)
STRIPE_SECRET_KEY=sk_test_yourkey
MOLLIE_API_KEY=test_yourkey
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_SECRET=your_paypal_secret
PAYPAL_API_URL=https://api-m.sandbox.paypal.com
EOF
```

---

## 5️⃣ Link Supabase Project

Authenticate and link:

```bash
npx supabase login
npx supabase link --project-ref your_project_ref
```

Verify:

```bash
cat .supabase/config.toml
```

---

## 6️⃣ Extend the Template

Now that `.env.local` exists and Supabase is linked:

```bash
../extend-commerce-template.sh                     # chilli mode sync
../extend-commerce-template.sh --mode=generic      # generic mode sync
```

Extend copies the relevant `store-components` + `admin-components` pack into an existing project (non-destructively) and ensures the profile helper/payments/checkout API are in place. It does **not** rewrite migrations or prompt for Supabase keys.

---

## 7️⃣ Supabase Automation

No manual SQL editing is required. The generator handles everything:

1. **Schema** – `create-next-commerce-template-ssr.sh` copies `store-modes/<mode>/schema.sql` into `supabase/migrations/0001_init.sql` and runs `npx supabase db push`.
2. **Seeds** – it executes `store-modes/<mode>/seeds.sql` (plus `brand-single.sql` if you pick single-store mode) with `npx supabase db query`, so categories/brands/chilli types are ready immediately.
3. **Storage** – the script creates the `product-images` bucket, enables RLS on `storage.objects`, and applies public-read/authenticated-upload policies.

If you tweak a mode’s schema or seeds, update the files under `store-modes/<mode>/` and re-run the generator for new projects. Existing projects can manage their own migrations as usual.

---

## 8️⃣ Connect to GitHub

### Generate SSH Key

```bash
ssh-keygen -t ed25519 -C "clientname.dev@gmail.com"
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

### Add Public Key to GitHub

Add the public key (`~/.ssh/id_ed25519.pub`) to:
**GitHub → Settings → SSH and GPG Keys → New Key**

### Configure SSH

In `~/.ssh/config`:

```bash
Host github-clientname
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519
```

### Create Repository and Push

Create an empty GitHub repo called `clientname-store`, then:

```bash
git remote add origin git@github-clientname:clientname-sys/clientname-store.git
git branch -M main
git push -u origin main
```

---

## 9️⃣ Deploy to Vercel

1. Log into [vercel.com](https://vercel.com) with the new GitHub account
2. Click **Add → New Project → Import Git Repository**
3. Select `clientname-store`
4. Add environment variables from `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` (use your Vercel domain)
   - Payment provider keys
5. Click **Deploy**

Your site will be live at: `https://clientname-store.vercel.app/en`

---

## 🔟 Verify Deployment

### Post-Deployment Checklist

- [ ] Supabase tables visible in dashboard
- [ ] Auth (email/password) sign-up works
- [ ] Profile creation after sign-up succeeds
- [ ] `/checkout` page loads and requires authentication
- [ ] `/cart` and `/shop` pages load
- [ ] Multilingual routes work (`/en`, `/de`, `/tr`, `/ar`)
- [ ] RTL layout works correctly for Arabic (`/ar`)
- [ ] Vercel build logs show no errors

### Expected Results

| Check | Expected Result |
|-------|----------------|
| Supabase tables exist | ✅ |
| Auth sign-up creates profiles row | ✅ |
| Checkout page loads | ✅ |
| Multilingual routes `/en`, `/de`, `/tr`, `/ar` | ✅ |
| Vercel deploy successful | ✅ |

---

## 📝 Quick Reference

### Command Summary

| Step | Description | Command |
|------|-------------|---------|
| 1 | Create accounts | Manual (Gmail, GitHub, Supabase, Vercel) |
| 2 | Scaffold project | `./create-next-commerce-template-ssr.sh [name] [locale] [locales]` |
| 3 | Add environment variables | Edit `.env.local` |
| 4 | Link Supabase | `npx supabase link --project-ref [ref]` |
| 5 | Extend template | `../extend-commerce-template.sh` |
| 6 | Install dependencies | `pnpm install` |
| 7 | Push database schema | `npx supabase db push` |
| 8 | Connect GitHub | `git remote add origin [url]` |
| 9 | Deploy to Vercel | Via dashboard |
| 10 | Verify deployment | Browser test |

### Scripts Reference

#### `create-next-commerce-template-ssr.sh`
Scaffolds a multilingual Next.js 16 + Supabase SSR e-commerce project with:
- Tailwind CSS 4 with RTL support
- Email/password authentication
- i18n with next-intl
- Protected routes
- Database migrations

#### `extend-commerce-template.sh`
Extends the base template with:
- Profile helper functions
- Payment adapters (Stripe, PayPal, Mollie) with lazy initialization
- Checkout API route
- Next.js 16 compatibility (async cookies)

---

## 💡 Tips & Best Practices

- **SSH Keys**: Use unique SSH keys per GitHub account to avoid conflicts
- **Accounts**: Use the same email/GitHub combo for Supabase and Vercel per project
- **Organization**: Keep generated stores in `~/websites`, outside the shopforge repo
- **Environment Variables**: Never commit `.env.local` to Git (already in `.gitignore`)
- **Testing**: Always test locally with `pnpm dev` before deploying
- **Database**: Use Supabase local development (`supabase start`) for testing migrations
- **Payments**: Use test/sandbox keys during development

---

## 🧠 Optional Automation Ideas

Enhance `create-next-commerce-template-ssr.sh` to:

1. Prompt for Supabase keys interactively
2. Auto-generate `.env.local` with provided values
3. Auto-create `/supabase/migrations/0001_init.sql`
4. Run `npx supabase db push` automatically
5. Print "Next Steps" summary with project-specific values

Then every new project will be ready end-to-end from a single command.

---

## 🏗️ Tech Stack

- **Framework**: Next.js 16 (App Router, React 19)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4 with RTL support
- **Backend**: Supabase (PostgreSQL + Auth)
- **i18n**: next-intl
- **Payments**: Stripe, PayPal, Mollie
- **Hosting**: Vercel
- **Package Manager**: pnpm

---

## 📄 License

This setup guide and scripts are provided as-is for creating e-commerce projects. Customize freely for your needs.

---

## Generated Output Example

Running the chilli template:

```
./create-next-commerce-template-ssr.sh test-chilli en
```

Produces a Next.js app with:

```
 test-chilli/
 ├─ .env.local                        # filled with Supabase keys you entered
 ├─ supabase/
 │  └─ migrations/0001_init.sql       # copied from store-modes/chilli/schema.sql
 ├─ src/
 │  ├─ components/store/              # chilli storefront pack
 │  ├─ app/[locale]/admin/            # chilli admin pack (dashboard, CRUD)
 │  ├─ lib/supabase/                  # SSR/client helpers (auto-installed)
 │  └─ app/[locale]/auth/*            # ready-made auth pages
 ├─ public/
 ├─ package.json
 └─ ...
```

Generic mode is similar but copies the `store-modes/generic` assets and applies the generic schema/seeds (no chilli metadata). After scaffolding, run `pnpm dev` and visit `http://localhost:3000/<locale>`.
