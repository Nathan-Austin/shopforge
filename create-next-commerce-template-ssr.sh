#!/usr/bin/env bash
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is required (please install Node 18+)." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "❌ pnpm is required (install via: corepack enable pnpm)." >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "❌ npx (Node.js) is required." >&2
  exit 1
fi

if ! npx --yes supabase --help >/dev/null 2>&1; then
  echo "❌ Supabase CLI not found. Install via npm: npm i -g supabase." >&2
  exit 1
fi

STORE_MODE="chilli"
POSITIONAL=()
for arg in "$@"; do
  case $arg in
    --mode=*)
      STORE_MODE="${arg#--mode=}"
      ;;
    *)
      POSITIONAL+=("$arg")
      ;;
  esac
done
set -- "${POSITIONAL[@]}"

APP_NAME=${1:-next-commerce-template}
DEFAULT_LOCALE=${2:-en}
LOCALES_CSV=${3:-"en,de,tr,ar"}  # comma-separated

MODE_DIR="$SCRIPT_DIR/store-modes/$STORE_MODE"
if [ ! -d "$MODE_DIR" ]; then
  echo "❌ Unknown store mode: $STORE_MODE" >&2
  echo "   Available modes:" >&2
  ls "$SCRIPT_DIR/store-modes" >&2
  exit 1
fi

echo "🚀 Creating Next.js + Tailwind + Supabase (SSR) eCommerce Template: $APP_NAME"

# 1) Scaffold real Next.js app via official CLI (prevents Tailwind breakage)
pnpm create next-app@latest $APP_NAME \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --yes

cd "$APP_NAME"

ENV_FILE=".env.local"
touch "$ENV_FILE"

get_env_var() {
  if [ -f "$ENV_FILE" ]; then
    grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2-
  fi
}

set_env_var() {
  VAR_NAME="$1" VAR_VALUE="$2" ENV_PATH="$ENV_FILE" python3 <<'PY'
import os, pathlib, re
env_path = pathlib.Path(os.environ['ENV_PATH'])
text = env_path.read_text() if env_path.exists() else ""
pattern = re.compile(rf"^{re.escape(os.environ['VAR_NAME'])}=.*$", re.MULTILINE)
line = f"{os.environ['VAR_NAME']}={os.environ['VAR_VALUE']}"
if pattern.search(text):
    text = pattern.sub(line, text)
else:
    if text and not text.endswith("\n"):
        text += "\n"
    text += line + "\n"
env_path.write_text(text)
PY
}

ensure_env_default() {
  local var="$1"
  local value="$2"
  local existing
  existing=$(get_env_var "$var")
  if [ -z "$existing" ]; then
    set_env_var "$var" "$value"
    existing="$value"
  fi
  export "$var=$existing"
}

prompt_env_var() {
  local var="$1"
  local prompt="$2"
  local silent="$3"
  local existing
  existing=$(get_env_var "$var")
  if [ -n "$existing" ]; then
    export "$var=$existing"
    return
  fi
  local input=""
  while [ -z "$input" ]; do
    if [ "$silent" = "true" ]; then
      read -r -s -p "$prompt: " input
      echo ""
    else
      read -r -p "$prompt: " input
    fi
    if [ -z "$input" ]; then
      echo "Value required."
    fi
  done
  set_env_var "$var" "$input"
  export "$var=$input"
}

ensure_store_mode() {
  local existing
  existing=$(get_env_var "NEXT_PUBLIC_STORE_MODE")
  if [ -z "$existing" ]; then
    read -r -p "Store mode (single/multi) [single]: " mode
    if [ -z "$mode" ]; then
      mode="single"
    fi
    if [ "$mode" != "multi" ]; then
      mode="single"
    fi
    set_env_var "NEXT_PUBLIC_STORE_MODE" "$mode"
    existing="$mode"
  fi
  export NEXT_PUBLIC_STORE_MODE="$existing"
}

# 2) Install deps
echo "📦 Installing dependencies..."
pnpm add @supabase/supabase-js @supabase/ssr next-intl react-hook-form zod clsx tailwind-merge class-variance-authority lucide-react @radix-ui/react-slot @radix-ui/react-label
pnpm add tailwindcss-rtl
pnpm add -D @types/node @types/react autoprefixer postcss prettier

# Optional: add Stripe now (commented)
# pnpm add stripe

# 3) Initialize Supabase (creates /supabase/)
echo "🧩 Initializing Supabase..."
npx supabase init

echo "🔐 Configuring Supabase credentials..."
prompt_env_var "NEXT_PUBLIC_SUPABASE_URL" "Supabase project URL (https://....supabase.co)" false
prompt_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "Supabase anon key" true
prompt_env_var "SUPABASE_SERVICE_ROLE_KEY" "Supabase service role key" true
prompt_env_var "SUPABASE_PROJECT_REF" "Supabase project ref (e.g. abcd1234)" false
ensure_store_mode

echo "🔗 Linking Supabase project..."
if ! npx supabase projects list >/dev/null 2>&1; then
  npx supabase login
fi
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"

echo "📝 Writing base database schema (${STORE_MODE})..."
mkdir -p supabase/migrations
cp "$MODE_DIR/schema.sql" supabase/migrations/0001_init.sql

echo "🗄️ Pushing schema to Supabase..."
npx supabase db push

echo "🪣 Creating product image bucket..."
npx supabase storage create-bucket product-images --public >/dev/null 2>&1 || true
npx supabase db query "alter table storage.objects enable row level security;"
npx supabase db query <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE polname = 'Public read product-images'
  ) THEN
    EXECUTE 'create policy "Public read product-images" on storage.objects for select using (bucket_id = ''product-images'');';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE polname = 'Authenticated upload product-images'
  ) THEN
    EXECUTE 'create policy "Authenticated upload product-images" on storage.objects for insert with check (bucket_id = ''product-images'' AND (auth.role() = ''authenticated''));';
  END IF;
END $$;
SQL

if [ -f "$MODE_DIR/seeds.sql" ]; then
  echo "🌱 Running ${STORE_MODE} seed data..."
  npx supabase db query < "$MODE_DIR/seeds.sql"
fi

if [ "$NEXT_PUBLIC_STORE_MODE" = "single" ] && [ -f "$MODE_DIR/brand-single.sql" ]; then
  echo "🏷️ Creating default single-store brand..."
  npx supabase db query < "$MODE_DIR/brand-single.sql"
fi

# 4) i18n middleware with next-intl
cat > middleware.ts <<'EOF'
import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
  locales: ['__LOCALES__'],
  defaultLocale: '__DEFAULT__',
});

export const config = {
  matcher: ['/((?!_next|api|.*\\..*).*)']
};
EOF
# inject locales/default
sed -i "s/__DEFAULT__/$DEFAULT_LOCALE/g" middleware.ts
SED_LOCALES=$(echo "$LOCALES_CSV" | sed "s/,/', '/g")
sed -i "s/'__LOCALES__'/'$SED_LOCALES'/g" middleware.ts

# 5) Messages (minimal) for next-intl
mkdir -p src/messages
cat > src/messages/en.json <<'EOF'
{
  "Auth": {
    "SignIn": "Sign in",
    "SignUp": "Sign up",
    "Email": "Email",
    "Password": "Password",
    "ConfirmPassword": "Confirm password",
    "ResetPassword": "Reset password"
  },
  "Nav": {
    "Shop": "Shop",
    "Cart": "Cart",
    "Checkout": "Checkout",
    "Account": "Account"
  },
  "Admin": {
    "title": "Store admin",
    "dashboardHeading": "Manage your catalogue",
    "dashboardWelcomeHeading": "You're in control",
    "dashboardWelcomeCopy": "Use the admin panel to add new sauces, edit listings, and keep imagery fresh.",
    "nav": {
      "dashboard": "Dashboard",
      "products": "Products",
      "newProduct": "New product"
    },
    "stats": {
      "products": "Products",
      "brands": "Brands",
      "categories": "Categories"
    },
    "products": {
      "heading": "Product catalogue",
      "subheading": "Review and edit every sauce in your shop.",
      "newProduct": "New product",
      "editProduct": "Edit product",
      "name": "Name",
      "category": "Category",
      "brand": "Brand",
      "heat": "Heat",
      "price": "Price",
      "actions": "Actions",
      "edit": "Edit",
      "empty": "No products yet."
    },
    "form": {
      "name": "Name",
      "slug": "Slug",
      "price": "Price (cents)",
      "currency": "Currency",
      "description": "Description",
      "heatLevel": "Heat level",
      "selectHeat": "Select heat level",
      "category": "Category",
      "selectCategory": "Select category",
      "brand": "Brand",
      "selectBrand": "Select brand",
      "chilliTypes": "Chilli types",
      "multiSelectHint": "Hold Cmd/Ctrl to select multiple peppers.",
      "images": "Images",
      "imageAlt": "Product image",
      "noImage": "No image uploaded",
      "uploadImage": "Upload image",
      "uploading": "Uploading...",
      "removeImage": "Remove image",
      "createProduct": "Create product",
      "updateProduct": "Update product",
      "deleteProduct": "Delete product",
      "deleteConfirm": "Delete this product?",
      "createDescription": "Add every detail about the sauce, then publish when you're ready.",
      "saved": "Saved successfully.",
      "notSet": "Not set"
    }
  }
}
EOF
cat > src/messages/de.json <<'EOF'
{
  "Auth": {
    "SignIn": "Anmelden",
    "SignUp": "Registrieren",
    "Email": "E-Mail",
    "Password": "Passwort",
    "ConfirmPassword": "Passwort bestätigen",
    "ResetPassword": "Passwort zurücksetzen"
  },
  "Nav": {
    "Shop": "Shop",
    "Cart": "Warenkorb",
    "Checkout": "Kasse",
    "Account": "Konto"
  },
  "Admin": {
    "title": "Store admin",
    "dashboardHeading": "Manage your catalogue",
    "dashboardWelcomeHeading": "You're in control",
    "dashboardWelcomeCopy": "Use the admin panel to add new sauces, edit listings, and keep imagery fresh.",
    "nav": {
      "dashboard": "Dashboard",
      "products": "Products",
      "newProduct": "New product"
    },
    "stats": {
      "products": "Products",
      "brands": "Brands",
      "categories": "Categories"
    },
    "products": {
      "heading": "Product catalogue",
      "subheading": "Review and edit every sauce in your shop.",
      "newProduct": "New product",
      "editProduct": "Edit product",
      "name": "Name",
      "category": "Category",
      "brand": "Brand",
      "heat": "Heat",
      "price": "Price",
      "actions": "Actions",
      "edit": "Edit",
      "empty": "No products yet."
    },
    "form": {
      "name": "Name",
      "slug": "Slug",
      "price": "Price (cents)",
      "currency": "Currency",
      "description": "Description",
      "heatLevel": "Heat level",
      "selectHeat": "Select heat level",
      "category": "Category",
      "selectCategory": "Select category",
      "brand": "Brand",
      "selectBrand": "Select brand",
      "chilliTypes": "Chilli types",
      "multiSelectHint": "Hold Cmd/Ctrl to select multiple peppers.",
      "images": "Images",
      "imageAlt": "Product image",
      "noImage": "No image uploaded",
      "uploadImage": "Upload image",
      "uploading": "Uploading...",
      "removeImage": "Remove image",
      "createProduct": "Create product",
      "updateProduct": "Update product",
      "deleteProduct": "Delete product",
      "deleteConfirm": "Delete this product?",
      "createDescription": "Add every detail about the sauce, then publish when you're ready.",
      "saved": "Saved successfully.",
      "notSet": "Not set"
    }
  }
}
EOF
cat > src/messages/tr.json <<'EOF'
{
  "Auth": {
    "SignIn": "Giriş yap",
    "SignUp": "Kayıt ol",
    "Email": "E-posta",
    "Password": "Şifre",
    "ConfirmPassword": "Şifreyi onayla",
    "ResetPassword": "Şifreyi sıfırla"
  },
  "Nav": {
    "Shop": "Mağaza",
    "Cart": "Sepet",
    "Checkout": "Ödeme",
    "Account": "Hesap"
  },
  "Admin": {
    "title": "Store admin",
    "dashboardHeading": "Manage your catalogue",
    "dashboardWelcomeHeading": "You're in control",
    "dashboardWelcomeCopy": "Use the admin panel to add new sauces, edit listings, and keep imagery fresh.",
    "nav": {
      "dashboard": "Dashboard",
      "products": "Products",
      "newProduct": "New product"
    },
    "stats": {
      "products": "Products",
      "brands": "Brands",
      "categories": "Categories"
    },
    "products": {
      "heading": "Product catalogue",
      "subheading": "Review and edit every sauce in your shop.",
      "newProduct": "New product",
      "editProduct": "Edit product",
      "name": "Name",
      "category": "Category",
      "brand": "Brand",
      "heat": "Heat",
      "price": "Price",
      "actions": "Actions",
      "edit": "Edit",
      "empty": "No products yet."
    },
    "form": {
      "name": "Name",
      "slug": "Slug",
      "price": "Price (cents)",
      "currency": "Currency",
      "description": "Description",
      "heatLevel": "Heat level",
      "selectHeat": "Select heat level",
      "category": "Category",
      "selectCategory": "Select category",
      "brand": "Brand",
      "selectBrand": "Select brand",
      "chilliTypes": "Chilli types",
      "multiSelectHint": "Hold Cmd/Ctrl to select multiple peppers.",
      "images": "Images",
      "imageAlt": "Product image",
      "noImage": "No image uploaded",
      "uploadImage": "Upload image",
      "uploading": "Uploading...",
      "removeImage": "Remove image",
      "createProduct": "Create product",
      "updateProduct": "Update product",
      "deleteProduct": "Delete product",
      "deleteConfirm": "Delete this product?",
      "createDescription": "Add every detail about the sauce, then publish when you're ready.",
      "saved": "Saved successfully.",
      "notSet": "Not set"
    }
  }
}
EOF
cat > src/messages/ar.json <<'EOF'
{
  "Auth": {
    "SignIn": "تسجيل الدخول",
    "SignUp": "إنشاء حساب",
    "Email": "البريد الإلكتروني",
    "Password": "كلمة المرور",
    "ConfirmPassword": "تأكيد كلمة المرور",
    "ResetPassword": "إعادة تعيين كلمة المرور"
  },
  "Nav": {
    "Shop": "المتجر",
    "Cart": "السلة",
    "Checkout": "الدفع",
    "Account": "الحساب"
  },
  "Admin": {
    "title": "Store admin",
    "dashboardHeading": "Manage your catalogue",
    "dashboardWelcomeHeading": "You're in control",
    "dashboardWelcomeCopy": "Use the admin panel to add new sauces, edit listings, and keep imagery fresh.",
    "nav": {
      "dashboard": "Dashboard",
      "products": "Products",
      "newProduct": "New product"
    },
    "stats": {
      "products": "Products",
      "brands": "Brands",
      "categories": "Categories"
    },
    "products": {
      "heading": "Product catalogue",
      "subheading": "Review and edit every sauce in your shop.",
      "newProduct": "New product",
      "editProduct": "Edit product",
      "name": "Name",
      "category": "Category",
      "brand": "Brand",
      "heat": "Heat",
      "price": "Price",
      "actions": "Actions",
      "edit": "Edit",
      "empty": "No products yet."
    },
    "form": {
      "name": "Name",
      "slug": "Slug",
      "price": "Price (cents)",
      "currency": "Currency",
      "description": "Description",
      "heatLevel": "Heat level",
      "selectHeat": "Select heat level",
      "category": "Category",
      "selectCategory": "Select category",
      "brand": "Brand",
      "selectBrand": "Select brand",
      "chilliTypes": "Chilli types",
      "multiSelectHint": "Hold Cmd/Ctrl to select multiple peppers.",
      "images": "Images",
      "imageAlt": "Product image",
      "noImage": "No image uploaded",
      "uploadImage": "Upload image",
      "uploading": "Uploading...",
      "removeImage": "Remove image",
      "createProduct": "Create product",
      "updateProduct": "Update product",
      "deleteProduct": "Delete product",
      "deleteConfirm": "Delete this product?",
      "createDescription": "Add every detail about the sauce, then publish when you're ready.",
      "saved": "Saved successfully.",
      "notSet": "Not set"
    }
  }
}
EOF

# 6) Tailwind RTL plugin config (non-destructive)
# Add plugin & enable logical properties
sed -i "1s;^;// NOTE: Generated by Next.js CLI. Modify safely; do not replace.\n;" tailwind.config.ts
sed -i "s/plugins: \[\]/plugins: \[require\('tailwindcss-rtl'\)\]/" tailwind.config.ts || true

# 6.5) UI Lib Utils & Components (shadcn-like)
mkdir -p src/lib src/components/ui

cat > src/lib/utils.ts <<'EOF'
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
EOF

cat > src/components/ui/card.tsx <<'EOF'
import * as React from "react"
import { cn } from "@/lib/utils"

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("rounded-xl border bg-card text-card-foreground shadow", className)} {...props} />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn("font-semibold leading-none tracking-tight", className)} {...props} />
))
CardTitle.displayName = "CardTitle"

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

export { Card, CardHeader, CardTitle, CardContent }
EOF

cat > src/components/ui/badge.tsx <<'EOF'
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
EOF

cat > src/components/ui/button.tsx <<'EOF'
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
EOF

cat > src/components/ui/input.tsx <<'EOF'
import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
EOF

cat > src/components/ui/label.tsx <<'EOF'
import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const labelVariants = cva(
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
)

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants(), className)}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
EOF

# 7) Supabase SSR helpers
mkdir -p src/lib/supabase

cat > src/lib/supabase/server.ts <<'EOF'
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const createClient = async () => {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );
};
EOF

cat > src/lib/supabase/client.ts <<'EOF'
import { createBrowserClient } from '@supabase/ssr';

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
EOF

# 8) Locale-aware root layout with RTL/LTR handling
mkdir -p src/app/[locale]
cat > src/app/[locale]/layout.tsx <<'EOF'
import { NextIntlClientProvider, unstable_setRequestLocale, getMessages } from 'next-intl/server';
import '../globals.css';
import type { ReactNode } from 'react';

const RTL_LOCALES = new Set(['ar', 'fa', 'he', 'ur']);

export const dynamic = 'force-dynamic';

export default async function LocaleLayout({
  children,
  params: { locale }
}: { children: ReactNode; params: { locale: string } }) {
  unstable_setRequestLocale(locale);
  const messages = await getMessages();
  const dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
EOF

# 9) Locale root page
cat > src/app/[locale]/page.tsx <<'EOF'
import Link from 'next/link';

export default function HomePage({ params: { locale } }: { params: { locale: string }}) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-3xl font-bold mb-6">Next Commerce Template</h1>
      <nav className="flex gap-4">
        <Link href={`/${locale}/shop`} className="underline">Shop</Link>
        <Link href={`/${locale}/cart`} className="underline">Cart</Link>
        <Link href={`/${locale}/checkout`} className="underline">Checkout</Link>
        <Link href={`/${locale}/auth/sign-in`} className="underline">Sign in</Link>
      </nav>
    </main>
  );
}
EOF

# 10) Minimal shop/cart/checkout pages; checkout protected server-side
mkdir -p src/app/[locale]/shop src/app/[locale]/cart src/app/[locale]/checkout
cat > src/app/[locale]/shop/page.tsx <<'EOF'
export default function ShopPage() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Shop</h1></div>;
}
EOF
cat > src/app/[locale]/cart/page.tsx <<'EOF'
export default function CartPage() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Cart</h1></div>;
}
EOF
cat > src/app/[locale]/checkout/page.tsx <<'EOF'
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function CheckoutPage({ params: { locale } }: { params: { locale: string }}) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect(`/${locale}/auth/sign-in`);

  return <div className="p-6"><h1 className="text-2xl font-bold">Checkout</h1></div>;
}
EOF

# 10.5) Copy store components
echo "🧱 Adding reusable store components (${STORE_MODE})..."
mkdir -p src/components/store
cp -R "$MODE_DIR/store-components/." src/components/store

# 10.6) Admin panel
echo "🛡️ Adding admin panel (${STORE_MODE})..."
mkdir -p src/app/[locale]/admin
cp -R "$MODE_DIR/admin-components/." src/app/[locale]/admin

# 11) Auth pages (email/password; no magic links)
mkdir -p src/app/[locale]/auth/sign-in src/app/[locale]/auth/sign-up src/app/[locale]/auth/reset-password

cat > src/app/[locale]/auth/sign-in/page.tsx <<'EOF'
'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter, useParams } from 'next/navigation';

export default function SignInPage() {
  const { locale } = useParams() as { locale: string };
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    else router.push(`/${locale}`);
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold mb-4">Sign in</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input className="w-full border p-2 rounded" placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/>
        <input className="w-full border p-2 rounded" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required/>
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <button className="w-full rounded bg-black text-white p-2">Sign in</button>
      </form>
    </main>
  );
}
EOF

cat > src/app/[locale]/auth/sign-up/page.tsx <<'EOF'
'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter, useParams } from 'next/navigation';

export default function SignUpPage() {
  const { locale } = useParams() as { locale: string };
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr('Passwords do not match');
      return;
    }
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setErr(error.message);
    else router.push(`/${locale}`);
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold mb-4">Sign up</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input className="w-full border p-2 rounded" placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/>
        <input className="w-full border p-2 rounded" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required/>
        <input className="w-full border p-2 rounded" placeholder="Confirm password" type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} required/>
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <button className="w-full rounded bg-black text-white p-2">Create account</button>
      </form>
    </main>
  );
}
EOF

cat > src/app/[locale]/auth/reset-password/page.tsx <<'EOF'
'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setInfo(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`
    });
    if (error) setErr(error.message);
    else setInfo('If your email exists, you will receive instructions shortly.');
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold mb-4">Reset password</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input className="w-full border p-2 rounded" placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/>
        {err && <p className="text-red-600 text-sm">{err}</p>}
        {info && <p className="text-green-700 text-sm">{info}</p>}
        <button className="w-full rounded bg-black text-white p-2">Send reset link</button>
      </form>
    </main>
  );
}
EOF

# 13) Simple profile creation helper (server action)
mkdir -p src/app/api/profile
cat > src/app/api/profile/route.ts <<'EOF'
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: existingProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError && profileError.code !== 'PGRST116') {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  let role = existingProfile?.role || null;
  if (!role) {
    const { count } = await supabase
      .from('profiles')
      .select('id', { head: true, count: 'exact' })
      .eq('role', 'shop_owner');
    role = (count ?? 0) === 0 ? 'shop_owner' : 'customer';
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, role }, { onConflict: 'id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ profile: data });
}
EOF

# 14) Ensure env defaults
echo "🧾 Ensuring .env.local defaults..."
set_env_default "NEXT_PUBLIC_SITE_URL" "http://localhost:3000"
set_env_default "STRIPE_SECRET_KEY" "sk_test_yourkey"
set_env_default "MOLLIE_API_KEY" "test_yourkey"
set_env_default "PAYPAL_CLIENT_ID" "your_paypal_client_id"
set_env_default "PAYPAL_SECRET" "your_paypal_secret"
set_env_default "PAYPAL_API_URL" "https://api-m.sandbox.paypal.com"
set_env_default "NEXTAUTH_SECRET" "changeme"

# 15) Dev README
cat > README.md <<'EOF'
# Next Commerce Template (Next.js + Supabase SSR + Tailwind + i18n + RTL)

- Generated with official Next.js CLI (Tailwind intact).
- Supabase Auth (email/password) with SSR cookies via @supabase/ssr.
- GDPR-friendly schema with RLS.
- next-intl with locales and RTL (`tailwindcss-rtl`).
- Minimal /shop, /cart, /checkout (checkout is protected).
- Auth pages (/auth/sign-in, /auth/sign-up, /auth/reset-password).

> IMPORTANT: Do not replace Tailwind/PostCSS/tsconfig scaffolds. Extend only.

## First run
1. Verify `.env.local` already contains the Supabase keys you entered during scaffolding.
2. `pnpm dev`

## After user signs up
POST `/api/profile` once to create the `profiles` row for the current user (id = auth.user.id).

## Production
Use `SUPABASE_SERVICE_ROLE_KEY` only in server contexts (never in the browser).
EOF

# 16) Git
git init
git add .
git commit -m "chore: scaffold Next.js + Supabase SSR eCommerce template with i18n & RTL and GDPR schema"

echo ""
echo "✅ Done! Next steps:"
echo "  cd $APP_NAME"
echo "  pnpm dev"
echo "  Open http://localhost:3000/$DEFAULT_LOCALE/auth/sign-in and create the first account (it becomes shop_owner automatically)."
echo ""
echo "📋 Supabase summary:"
echo "  • Project: $NEXT_PUBLIC_SUPABASE_URL (ref: $SUPABASE_PROJECT_REF)"
echo "  • Store mode: $STORE_MODE"
echo "  • Migration applied: supabase/migrations/0001_init.sql"
echo "  • Storage bucket: product-images (public read + authenticated upload policies)"
if [ -f "$MODE_DIR/seeds.sql" ]; then
  echo "  • Seed data source: $MODE_DIR/seeds.sql"
fi
if [ "$NEXT_PUBLIC_STORE_MODE" = "single" ] && [ -f "$MODE_DIR/brand-single.sql" ]; then
  echo "  • Default brand seeded for single-store setups."
fi
echo "  • Profile API promotes the first user to shop_owner automatically"
