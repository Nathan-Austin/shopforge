# 🧭 Next.js + Supabase + Vercel Multi-Client Setup Guide

A repeatable workflow for building new e-commerce websites using **Next.js 16 + Supabase SSR + TailwindCSS 4 + Vercel**, with separate accounts per project to stay on the free tiers.

---

## 📋 Table of Contents

1. [Workspace Setup](#%EF%B8%8F-workspace-setup)
2. [Create New Project Accounts](#1%EF%B8%8F⃣-create-new-project-accounts)
3. [Create Supabase Project](#2%EF%B8%8F⃣-create-supabase-project)
4. [Scaffold the Project](#3%EF%B8%8F⃣-scaffold-the-project)
5. [Configure Environment Variables](#4%EF%B8%8F⃣-configure-environment-variables)
6. [Link Supabase Project](#5%EF%B8%8F⃣-link-supabase-project)
7. [Extend the Template](#6%EF%B8%8F⃣-extend-the-template)
8. [Create & Push Database Schema](#7%EF%B8%8F⃣-create--push-database-schema)
9. [Connect to GitHub](#8%EF%B8%8F⃣-connect-to-github)
10. [Deploy to Vercel](#9%EF%B8%8F⃣-deploy-to-vercel)
11. [Verify Deployment](#%EF%B8%8F-verify-deployment)

---

## ⚙️ Workspace Setup

Keep all projects in one folder:

```
~/WEBDEV/
├── create-next-commerce-template-ssr.sh
├── extend-commerce-template.sh
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

## 3️⃣ Scaffold the Project

From `~/WEBDEV`:

```bash
./create-next-commerce-template-ssr.sh clientname-store en "en,de,tr,ar"
cd clientname-store
```

**Arguments:**
- `clientname-store` - Project name
- `en` - Default locale
- `"en,de,tr,ar"` - Comma-separated list of supported locales

---

## 4️⃣ Configure Environment Variables

Add your Supabase credentials now so later steps can connect:

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

Set `NEXT_PUBLIC_STORE_MODE` to either `single` or `multi` depending on your shop. The admin product form reads this value to decide whether to hide the brand selector (single-brand shops) or show it for multi-brand marketplaces.

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
../extend-commerce-template.sh
```

This adds:
- Profile helper functions
- Payment adapters (Stripe, PayPal, Mollie)
- Checkout API route

---

## 7️⃣ Create & Push Database Schema

If `/supabase/migrations` doesn't exist yet, create it:

```bash
mkdir -p supabase/migrations
nano supabase/migrations/0001_init.sql
```

Paste the base schema:

```sql
-- Profiles
create table if not exists profiles (
  id uuid references auth.users on delete cascade not null primary key,
  full_name text,
  email text unique,
  phone text,
  marketing_consent boolean default false,
  cookie_consent boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Addresses
create table if not exists addresses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade,
  full_name text,
  street text,
  city text,
  postal_code text,
  country text,
  phone text,
  created_at timestamptz default now()
);

-- Products
create table if not exists products (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  price_cents integer not null,
  currency text default 'EUR',
  image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Orders
create table if not exists orders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete set null,
  address_id uuid references addresses(id) on delete set null,
  total_cents integer not null,
  currency text default 'EUR',
  status text default 'pending',
  payment_provider text,
  provider_session_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Order items
create table if not exists order_items (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references orders(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  quantity integer not null default 1,
  unit_price_cents integer not null,
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_orders_user_id on orders(user_id);
create index if not exists idx_order_items_order_id on order_items(order_id);
```

Push the migration:

```bash
npx supabase db push
```

Confirm in the Supabase Table Editor that all tables exist.

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
- **Organization**: Keep all projects in `~/WEBDEV` for easy maintenance
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
