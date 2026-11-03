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

STORE_MODE="chilli"
# --skip-supabase: don't touch the Supabase CLI (no init/link/push) and fill
# .env.local with placeholder values. Used for tests and CI; the migrations
# are still written so they can be pushed later with `npx supabase db push`.
SKIP_SUPABASE="${SHOPFORGE_SKIP_SUPABASE:-false}"
POSITIONAL=()
for arg in "$@"; do
  case $arg in
    --mode=*)
      STORE_MODE="${arg#--mode=}"
      ;;
    --skip-supabase)
      SKIP_SUPABASE="true"
      ;;
    *)
      POSITIONAL+=("$arg")
      ;;
  esac
done
set -- "${POSITIONAL[@]}"

if [ "$SKIP_SUPABASE" != "true" ] && ! npx --yes supabase --help >/dev/null 2>&1; then
  echo "❌ Supabase CLI not found. Install via npm: npm i -g supabase." >&2
  exit 1
fi

APP_NAME=${1:-next-commerce-template}
DEFAULT_LOCALE=${2:-en}
LOCALES_CSV=${3:-"en,de,tr,ar"}  # comma-separated

MODE_DIR="$SCRIPT_DIR/store-modes/$STORE_MODE"
SHARED_DIR="$SCRIPT_DIR/shared-assets"
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
  local placeholder="$4"
  local existing
  existing=$(get_env_var "$var")
  # Already exported in the environment (e.g. CI) takes precedence over prompting
  if [ -z "$existing" ] && [ -n "${!var:-}" ]; then
    existing="${!var}"
    set_env_var "$var" "$existing"
  fi
  if [ -z "$existing" ] && [ "$SKIP_SUPABASE" = "true" ]; then
    existing="$placeholder"
    set_env_var "$var" "$existing"
  fi
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
  if [ -z "$existing" ] && [ -n "${NEXT_PUBLIC_STORE_MODE:-}" ]; then
    existing="$NEXT_PUBLIC_STORE_MODE"
    set_env_var "NEXT_PUBLIC_STORE_MODE" "$existing"
  fi
  if [ -z "$existing" ] && [ "$SKIP_SUPABASE" = "true" ]; then
    existing="single"
    set_env_var "NEXT_PUBLIC_STORE_MODE" "$existing"
  fi
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

# 1.5) Approve dependency build scripts up front.
# create-next-app pins pnpm 11 via "packageManager", and pnpm 11 fails
# `pnpm add` with ERR_PNPM_IGNORED_BUILDS when a new dependency has a build
# script that hasn't been approved. next-intl pulls in @parcel/watcher and
# @swc/core; both ship prebuilt binaries, so their scripts can stay off.
# Entries are written to pnpm-workspace.yaml so the store (and Vercel)
# installs without prompting.
approve_build_scripts() {
  WORKSPACE_FILE="pnpm-workspace.yaml" PACKAGES="$*" python3 <<'PY'
import os, pathlib, re
path = pathlib.Path(os.environ['WORKSPACE_FILE'])
text = path.read_text() if path.exists() else ""
packages = os.environ['PACKAGES'].split()

# Drop pnpm's "set this to true or false" placeholders for packages we handle
for pkg in packages:
    text = re.sub(rf"^\s+'?{re.escape(pkg)}'?:\s*set this to true or false\s*\n", "", text, flags=re.MULTILINE)

if not re.search(r"^allowBuilds:\s*$", text, re.MULTILINE):
    if text and not text.endswith("\n"):
        text += "\n"
    text += "allowBuilds:\n"

lines = text.splitlines(keepends=True)
out, in_block, present = [], False, set()
for line in lines:
    if re.match(r"^allowBuilds:\s*$", line):
        in_block = True
        out.append(line)
        continue
    if in_block:
        m = re.match(r"^\s+'?([^':]+)'?:", line)
        if m and line.startswith((" ", "\t")):
            present.add(m.group(1))
            out.append(line)
            continue
        if line.strip() == "":
            out.append(line)
            continue
        for pkg in packages:
            if pkg not in present:
                out.append(f"  '{pkg}': false\n")
                present.add(pkg)
        in_block = False
    out.append(line)
if in_block:
    for pkg in packages:
        if pkg not in present:
            out.append(f"  '{pkg}': false\n")
path.write_text("".join(out))
PY
}
approve_build_scripts '@parcel/watcher' '@swc/core' sharp unrs-resolver

# 2) Install deps
echo "📦 Installing dependencies..."
pnpm add @supabase/supabase-js @supabase/ssr next-intl react-hook-form zod clsx tailwind-merge class-variance-authority lucide-react @radix-ui/react-slot @radix-ui/react-label @radix-ui/react-select
# server-only turns importing a server module (the cart service holds the
# service-role key) from a client component into a build error.
pnpm add server-only
# stripe is imported by src/lib/stripe/server.ts (copied from shared-assets)
pnpm add stripe
# tailwindcss-rtl is Tailwind v3 only; Tailwind v4 has native rtl:/ltr: variants built-in
# Tailwind 4 runs through @tailwindcss/turbopack (see next.config.ts), so
# there is no postcss.config and no need for postcss/autoprefixer.
pnpm add -D @types/node @types/react prettier vitest

FIELD_PICKER="$SCRIPT_DIR/lib/product-fields.py"
FIELD_CATALOGUE="$SHARED_DIR/lib/products/catalogue.ts"
HEAT_JSON="null"

# Which product fields the admin panel manages. Every column exists in the
# database either way, so this is only about what the admin form shows and
# the server actions save; it can be changed later without a migration.
ensure_product_fields() {
  local existing answer
  existing=$(get_env_var "SHOPFORGE_PRODUCT_FIELDS")
  if [ -z "$existing" ] && [ -n "${SHOPFORGE_PRODUCT_FIELDS:-}" ]; then
    existing="$SHOPFORGE_PRODUCT_FIELDS"
  fi
  if [ -z "$existing" ] && [ "$SKIP_SUPABASE" = "true" ]; then
    existing="all"
  fi
  if [ -z "$existing" ]; then
    python3 "$FIELD_PICKER" menu "$FIELD_CATALOGUE" "$STORE_MODE"
    read -r -p "Fields: " answer
    existing="$answer"
  fi
  existing=$(python3 "$FIELD_PICKER" resolve "$FIELD_CATALOGUE" "$STORE_MODE" "$existing")
  set_env_var "SHOPFORGE_PRODUCT_FIELDS" "$existing"
  export SHOPFORGE_PRODUCT_FIELDS="$existing"
  echo "   Product fields: $existing"
}

# Chilli shops store heat as a number and choose how it reads to customers.
# Every word is optional: a shop that only says mild/medium/hot has three
# bands, and one that wants numbers only has none.
ensure_heat_scale() {
  if [ "$STORE_MODE" != "chilli" ]; then
    HEAT_JSON="null"
    return
  fi

  local max bands display answer word bound
  max=$(get_env_var "SHOPFORGE_HEAT_MAX")
  bands=$(get_env_var "SHOPFORGE_HEAT_BANDS")
  display=$(get_env_var "SHOPFORGE_HEAT_DISPLAY")
  [ -z "$max" ] && max="${SHOPFORGE_HEAT_MAX:-}"
  [ -z "$bands" ] && bands="${SHOPFORGE_HEAT_BANDS:-}"
  [ -z "$display" ] && display="${SHOPFORGE_HEAT_DISPLAY:-}"

  if [ -z "$max" ] && [ "$SKIP_SUPABASE" = "true" ]; then
    max="10"
    bands="Mild:3,Medium:6,Hot:8,Extra hot:9,Extreme:10"
    display="both"
  fi

  if [ -z "$max" ]; then
    echo ""
    echo "🌶️  Heat scale"
    echo "   Heat is stored as a number, so you can change the wording later."
    read -r -p "   Scale maximum (5, 10 or 20) [10]: " answer
    case "$answer" in
      5|10|20) max="$answer" ;;
      "") max="10" ;;
      *) max="$answer" ;;
    esac
    if ! [ "$max" -gt 0 ] 2>/dev/null; then
      echo "   Not a number, using 10."
      max="10"
    fi

    read -r -p "   Use words (mild, hot, ...) as well as numbers? [Y/n]: " answer
    if [[ $answer =~ ^[Nn]$ ]]; then
      bands=""
      display="number"
    else
      echo "   For each word, give the highest level it covers (0-$max)."
      echo "   Press Enter to skip a word you do not use."
      bands=""
      for word in "Mild" "Medium" "Hot" "Extra hot" "Extreme"; do
        read -r -p "     $word, up to: " bound
        if [ -n "$bound" ] && [ "$bound" -ge 0 ] 2>/dev/null; then
          if [ -n "$bands" ]; then bands="$bands,"; fi
          bands="$bands$word:$bound"
        fi
      done
      echo "   How should heat appear in the shop?"
      echo "     1) Word and number, e.g. Hot (7/$max)"
      echo "     2) Word only, e.g. Hot"
      echo "     3) Number only, e.g. 7/$max"
      echo "     4) Chilli icons"
      read -r -p "   Choice [1]: " answer
      case "$answer" in
        2) display="word" ;;
        3) display="number" ;;
        4) display="peppers" ;;
        *) display="both" ;;
      esac
    fi
  fi

  [ -z "$display" ] && display="both"

  set_env_var "SHOPFORGE_HEAT_MAX" "$max"
  set_env_var "SHOPFORGE_HEAT_BANDS" "$bands"
  set_env_var "SHOPFORGE_HEAT_DISPLAY" "$display"

  HEAT_JSON=$(HEAT_MAX="$max" HEAT_BANDS="$bands" HEAT_DISPLAY="$display" python3 <<'PYHEAT'
import json, os
max_level = int(os.environ['HEAT_MAX'])
bands = []
for part in os.environ['HEAT_BANDS'].split(','):
    part = part.strip()
    if not part or ':' not in part:
        continue
    word, _, bound = part.rpartition(':')
    bands.append({'word': word.strip(), 'upTo': min(int(bound), max_level)})
bands.sort(key=lambda band: band['upTo'])
print(json.dumps({'max': max_level, 'display': os.environ['HEAT_DISPLAY'], 'bands': bands}))
PYHEAT
)
  export SHOPFORGE_HEAT_MAX="$max"
}

# 2.5) Copy shared-assets/lib (production-grade)
echo "📦 Copying production-grade shared libraries..."
mkdir -p src/lib
cp -R "$SHARED_DIR/lib/." src/lib/
mkdir -p src/components
cp -R "$SHARED_DIR/components/." src/components/

# 3) Initialize Supabase (creates /supabase/)
if [ "$SKIP_SUPABASE" = "true" ]; then
  echo "🧩 Skipping Supabase CLI (--skip-supabase); writing placeholder credentials..."
  mkdir -p supabase
else
  echo "🧩 Initializing Supabase..."
  npx supabase init
fi

echo "🔐 Configuring Supabase credentials..."
prompt_env_var "NEXT_PUBLIC_SUPABASE_URL" "Supabase project URL (https://....supabase.co)" false "https://placeholder.supabase.co"
prompt_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "Supabase anon key" true "placeholder-anon-key"
prompt_env_var "SUPABASE_SERVICE_ROLE_KEY" "Supabase service role key" true "placeholder-service-role-key"
prompt_env_var "SUPABASE_PROJECT_REF" "Supabase project ref (e.g. abcd1234)" false "placeholder"
ensure_store_mode

echo "🧱 Choosing product fields..."
ensure_product_fields
ensure_heat_scale

echo "🗂️  Writing product field config..."
mkdir -p src/lib/products
python3 "$FIELD_PICKER" config \
  "$FIELD_CATALOGUE" "$STORE_MODE" "$SHOPFORGE_PRODUCT_FIELDS" "$HEAT_JSON" \
  src/lib/products/config.ts

if [ "$SKIP_SUPABASE" = "true" ]; then
  echo "🔗 Skipping Supabase link (--skip-supabase)."
else
echo "🔗 Linking Supabase project..."
# Attempt to list projects to check login status
if ! npx supabase projects list >/dev/null 2>&1; then
  echo "🔑 Not logged into Supabase. Please log in."
  npx supabase login
else
  # Check if the project ref is accessible with the current login
  if ! npx supabase projects list | grep -q "$SUPABASE_PROJECT_REF"; then
    echo "⚠️  Current Supabase account doesn't have access to project $SUPABASE_PROJECT_REF."
    echo "   The project may belong to a different Supabase account."
    read -r -p "Log out and log in with the correct account? [Y/n]: " login_again
    if [[ $login_again =~ ^[Yy]$ ]] || [ -z "$login_again" ]; then
      npx supabase logout
      npx supabase login
    else
      echo "⚠️  Continuing with current account, but 'supabase link' may fail."
    fi
  fi
fi

# Link the project (will prompt for database password)
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
fi

echo "📝 Preparing database migrations (${STORE_MODE})..."
mkdir -p supabase/migrations

# 1. Base Schema
cp "$MODE_DIR/schema.sql" supabase/migrations/0001_init.sql

# 2. Seed Data
if [ -f "$MODE_DIR/seeds.sql" ]; then
  cp "$MODE_DIR/seeds.sql" supabase/migrations/0002_seeds.sql
  # Seed heat values are written on a 0-10 basis as __HEAT_n__ and rescaled
  # to whatever heat scale this shop chose.
  HEAT_MAX="${SHOPFORGE_HEAT_MAX:-10}" python3 <<'PYSEED'
import os, pathlib, re
path = pathlib.Path('supabase/migrations/0002_seeds.sql')
text = path.read_text()
max_level = int(os.environ['HEAT_MAX'])
text = re.sub(
    r'__HEAT_(\d+)__',
    lambda m: str(round(int(m.group(1)) / 10 * max_level)),
    text,
)
path.write_text(text)
PYSEED
fi

# 3. Single Store Brand
if [ "$NEXT_PUBLIC_STORE_MODE" = "single" ] && [ -f "$MODE_DIR/brand-single.sql" ]; then
  cp "$MODE_DIR/brand-single.sql" supabase/migrations/0003_brand_single.sql
fi

# 4. Storage Policies (Standard for all templates)
cat > supabase/migrations/0004_storage_policies.sql <<'SQL'
-- Storage Policies
-- Note: 'product-images' bucket must be created in the Supabase Dashboard.
-- These policies apply once the bucket exists.
-- RLS should be enabled via the Dashboard Storage settings.

create policy "Public read product-images" 
on storage.objects for select 
using (bucket_id = 'product-images');

create policy "Authenticated upload product-images" 
on storage.objects for insert 
with check (bucket_id = 'product-images' AND (auth.role() = 'authenticated'));

create policy "Authenticated delete product-images" 
on storage.objects for delete 
using (bucket_id = 'product-images' AND (auth.role() = 'authenticated'));
SQL

if [ "$SKIP_SUPABASE" = "true" ]; then
  echo "🗄️ Migrations written to supabase/migrations (not pushed: --skip-supabase)."
  echo "   Later: fill in .env.local, then 'npx supabase init && npx supabase link --project-ref <ref> && npx supabase db push'."
else
  echo "🗄️ Pushing all migrations to Supabase..."
  npx supabase db push --yes
fi

# Note: Buckets and Storage RLS are difficult to manage via CLI for remote projects.
echo ""
echo "🪣 SUPABASE STORAGE SETUP (Manual Steps):"
echo "  1. Log into your Supabase Dashboard."
echo "  2. Go to 'Storage' and create a NEW PUBLIC BUCKET named 'product-images'."
echo "  3. The security policies (0004) are already pushed and will apply automatically."



# 4) i18n proxy with next-intl
# Next 16 renamed the `middleware` file convention to `proxy`; a default
# export is still what the convention expects. next-intl itself has no
# ./proxy entrypoint yet, so the import path stays next-intl/middleware.
# NOTE: with --src-dir this must be src/proxy.ts. Unlike middleware.ts,
# a proxy.ts in the project root is ignored silently (no build warning),
# which would leave the store with no locale routing at all.
cat > src/proxy.ts <<'EOF'
import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
  locales: ['__LOCALES__'],
  defaultLocale: '__DEFAULT__',
});

export const config = {
  matcher: ['/((?!_next|api|auth/callback|.*\\..*).*)']
};
EOF
# inject locales/default
sed -i "s|__DEFAULT__|$DEFAULT_LOCALE|g" src/proxy.ts
SED_LOCALES=$(echo "$LOCALES_CSV" | sed "s|,|', '|g")
sed -i "s|'__LOCALES__'|'$SED_LOCALES'|g" src/proxy.ts

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
  "Shop": {
    "title": "Shop",
    "empty": "No products yet."
  },
  "Cart": {
    "title": "Cart",
    "empty": "Your cart is empty.",
    "badgeLabel": "Cart, {count} items",
    "addToCart": "Add to cart",
    "adding": "Adding...",
    "added": "Added ✓",
    "addFailed": "Could not add this item.",
    "updateFailed": "Could not update your cart.",
    "outOfStock": "Out of stock",
    "limitedToStock": "We only had a few left, so we added what we could.",
    "maxReached": "Maximum reached",
    "noLongerAvailable": "No longer available",
    "removeUnavailable": "Remove the unavailable items to continue.",
    "size": "Size",
    "colour": "Colour",
    "increase": "Increase quantity",
    "decrease": "Decrease quantity",
    "remove": "Remove",
    "clear": "Empty cart",
    "subtotal": "Subtotal",
    "shippingAtCheckout": "Shipping is calculated at checkout.",
    "checkout": "Checkout",
    "continueShopping": "Continue shopping"
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
  },
  "UI": {
    "product": {
      "featuredSauces": "Featured products",
      "sauce": "product",
      "sauces": "products"
    },
    "actions": {
      "viewProducer": "View brand",
      "visitWebsite": "Visit website"
    }
  },
  "SauceArchive": {
    "search": {
      "placeholder": "Search products",
      "filters": {
        "sauceType": "Category",
        "allCategories": "All categories",
        "sort": "Sort",
        "sortNewest": "Newest",
        "sortPopular": "Popular",
        "heatLevel": "Heat level",
        "pepper": "Chilli type",
        "allChilliTypes": "All chilli types",
        "sortMildToHot": "Mild to hot",
        "sortHotToMild": "Hot to mild"
      }
    },
    "results": {
      "showing": "Showing",
      "of": "of",
      "sauces": "products",
      "noResults": "No matches",
      "adjustSearch": "Try a different search or filter.",
      "loadMore": "Load more",
      "clearFilters": "Clear filters"
    }
  },
  "homepage": {
    "producerShowcase": {
      "eyebrow": "Brands",
      "title": "Who makes it",
      "viewAll": "View all",
      "seeMore": "See more"
    }
  },
  "Checkout": {
    "title": "Checkout",
    "subtotal": "Subtotal",
    "shippingNote": "Shipping is added on the next step.",
    "cartProblem": "Your cart is empty or contains items that are no longer available.",
    "backToCart": "Back to cart",
    "email": "Email",
    "firstName": "First name",
    "lastName": "Last name",
    "address": "Address",
    "city": "City",
    "postalCode": "Postcode",
    "country": "Country (3-letter code)",
    "payNow": "Pay now",
    "redirecting": "Redirecting...",
    "failed": "We could not start the payment. Please try again.",
    "stockChanged": "Something in your cart sold out. Please check your cart.",
    "successTitle": "Thank you for your order",
    "keepShopping": "Keep shopping",
    "successBody": "Your payment went through and we have emailed your receipt.",
    "cancelTitle": "Payment cancelled",
    "cancelBody": "You were not charged. Your cart is just as you left it, so you can pick up where you stopped whenever you like.",
    "tryAgain": "Back to checkout",
    "processing": "We are confirming your payment. This page will update by itself in a moment.",
    "orderNumber": "Order {number}",
    "items": "Items",
    "shippingCost": "Shipping",
    "total": "Total",
    "shipTo": "Delivering to",
    "createAccountTitle": "Keep track of this order",
    "createAccountBody": "Create an account with {email} and this order will be saved to it once you confirm your email address.",
    "createAccount": "Create account",
    "savedToAccount": "This order is saved to your account."
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
  "Shop": {
    "title": "Shop",
    "empty": "Noch keine Produkte."
  },
  "Cart": {
    "title": "Warenkorb",
    "empty": "Ihr Warenkorb ist leer.",
    "badgeLabel": "Warenkorb, {count} Artikel",
    "addToCart": "In den Warenkorb",
    "adding": "Wird hinzugefügt...",
    "added": "Hinzugefügt ✓",
    "addFailed": "Artikel konnte nicht hinzugefügt werden.",
    "updateFailed": "Warenkorb konnte nicht aktualisiert werden.",
    "outOfStock": "Ausverkauft",
    "limitedToStock": "Es waren nur noch wenige verfügbar, wir haben so viele wie möglich hinzugefügt.",
    "maxReached": "Maximum erreicht",
    "noLongerAvailable": "Nicht mehr verfügbar",
    "removeUnavailable": "Entfernen Sie die nicht verfügbaren Artikel, um fortzufahren.",
    "size": "Größe",
    "colour": "Farbe",
    "increase": "Menge erhöhen",
    "decrease": "Menge verringern",
    "remove": "Entfernen",
    "clear": "Warenkorb leeren",
    "subtotal": "Zwischensumme",
    "shippingAtCheckout": "Versandkosten werden an der Kasse berechnet.",
    "checkout": "Zur Kasse",
    "continueShopping": "Weiter einkaufen"
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
  },
  "UI": {
    "product": {
      "featuredSauces": "Ausgewählte Produkte",
      "sauce": "Produkt",
      "sauces": "Produkte"
    },
    "actions": {
      "viewProducer": "Marke ansehen",
      "visitWebsite": "Website besuchen"
    }
  },
  "SauceArchive": {
    "search": {
      "placeholder": "Produkte suchen",
      "filters": {
        "sauceType": "Kategorie",
        "allCategories": "Alle Kategorien",
        "sort": "Sortieren",
        "sortNewest": "Neueste",
        "sortPopular": "Beliebt",
        "heatLevel": "Schärfegrad",
        "pepper": "Chilisorte",
        "allChilliTypes": "Alle Chilisorten",
        "sortMildToHot": "Mild bis scharf",
        "sortHotToMild": "Scharf bis mild"
      }
    },
    "results": {
      "showing": "Angezeigt",
      "of": "von",
      "sauces": "Produkte",
      "noResults": "Keine Treffer",
      "adjustSearch": "Versuchen Sie eine andere Suche oder einen anderen Filter.",
      "loadMore": "Mehr laden",
      "clearFilters": "Filter zurücksetzen"
    }
  },
  "homepage": {
    "producerShowcase": {
      "eyebrow": "Marken",
      "title": "Wer es herstellt",
      "viewAll": "Alle ansehen",
      "seeMore": "Mehr sehen"
    }
  },
  "Checkout": {
    "title": "Kasse",
    "subtotal": "Zwischensumme",
    "shippingNote": "Der Versand wird im nächsten Schritt hinzugefügt.",
    "cartProblem": "Ihr Warenkorb ist leer oder enthält nicht mehr verfügbare Artikel.",
    "backToCart": "Zurück zum Warenkorb",
    "email": "E-Mail",
    "firstName": "Vorname",
    "lastName": "Nachname",
    "address": "Adresse",
    "city": "Stadt",
    "postalCode": "Postleitzahl",
    "country": "Land (3-stelliger Code)",
    "payNow": "Jetzt bezahlen",
    "redirecting": "Weiterleitung...",
    "failed": "Die Zahlung konnte nicht gestartet werden. Bitte erneut versuchen.",
    "stockChanged": "Ein Artikel ist ausverkauft. Bitte prüfen Sie Ihren Warenkorb.",
    "successTitle": "Vielen Dank für Ihre Bestellung",
    "keepShopping": "Weiter einkaufen",
    "successBody": "Ihre Zahlung war erfolgreich, die Rechnung ist unterwegs.",
    "cancelTitle": "Zahlung abgebrochen",
    "cancelBody": "Es wurde nichts abgebucht. Ihr Warenkorb ist unverändert, Sie können jederzeit fortfahren.",
    "tryAgain": "Zurück zur Kasse",
    "processing": "Wir bestätigen gerade Ihre Zahlung. Diese Seite aktualisiert sich gleich von selbst.",
    "orderNumber": "Bestellung {number}",
    "items": "Artikel",
    "shippingCost": "Versand",
    "total": "Gesamt",
    "shipTo": "Lieferung an",
    "createAccountTitle": "Bestellung im Blick behalten",
    "createAccountBody": "Erstellen Sie ein Konto mit {email}. Sobald Sie Ihre E-Mail-Adresse bestätigt haben, wird diese Bestellung darin gespeichert.",
    "createAccount": "Konto erstellen",
    "savedToAccount": "Diese Bestellung ist in Ihrem Konto gespeichert."
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
  "Shop": {
    "title": "Mağaza",
    "empty": "Henüz ürün yok."
  },
  "Cart": {
    "title": "Sepet",
    "empty": "Sepetiniz boş.",
    "badgeLabel": "Sepet, {count} ürün",
    "addToCart": "Sepete ekle",
    "adding": "Ekleniyor...",
    "added": "Eklendi ✓",
    "addFailed": "Bu ürün eklenemedi.",
    "updateFailed": "Sepetiniz güncellenemedi.",
    "outOfStock": "Stokta yok",
    "limitedToStock": "Stokta az kalmıştı, ekleyebildiğimiz kadarını ekledik.",
    "maxReached": "Üst sınıra ulaşıldı",
    "noLongerAvailable": "Artık mevcut değil",
    "removeUnavailable": "Devam etmek için mevcut olmayan ürünleri kaldırın.",
    "size": "Beden",
    "colour": "Renk",
    "increase": "Adedi artır",
    "decrease": "Adedi azalt",
    "remove": "Kaldır",
    "clear": "Sepeti boşalt",
    "subtotal": "Ara toplam",
    "shippingAtCheckout": "Kargo ücreti ödeme adımında hesaplanır.",
    "checkout": "Ödemeye geç",
    "continueShopping": "Alışverişe devam et"
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
  },
  "UI": {
    "product": {
      "featuredSauces": "Öne çıkan ürünler",
      "sauce": "ürün",
      "sauces": "ürün"
    },
    "actions": {
      "viewProducer": "Markayı gör",
      "visitWebsite": "Siteyi ziyaret et"
    }
  },
  "SauceArchive": {
    "search": {
      "placeholder": "Ürün ara",
      "filters": {
        "sauceType": "Kategori",
        "allCategories": "Tüm kategoriler",
        "sort": "Sırala",
        "sortNewest": "En yeni",
        "sortPopular": "Popüler",
        "heatLevel": "Acı seviyesi",
        "pepper": "Biber türü",
        "allChilliTypes": "Tüm biber türleri",
        "sortMildToHot": "Hafiften acıya",
        "sortHotToMild": "Acıdan hafife"
      }
    },
    "results": {
      "showing": "Gösterilen",
      "of": "/",
      "sauces": "ürün",
      "noResults": "Sonuç yok",
      "adjustSearch": "Farklı bir arama veya filtre deneyin.",
      "loadMore": "Daha fazla yükle",
      "clearFilters": "Filtreleri temizle"
    }
  },
  "homepage": {
    "producerShowcase": {
      "eyebrow": "Markalar",
      "title": "Üreticiler",
      "viewAll": "Tümünü gör",
      "seeMore": "Daha fazla"
    }
  },
  "Checkout": {
    "title": "Ödeme",
    "subtotal": "Ara toplam",
    "shippingNote": "Kargo bir sonraki adımda eklenir.",
    "cartProblem": "Sepetiniz boş veya artık mevcut olmayan ürünler içeriyor.",
    "backToCart": "Sepete dön",
    "email": "E-posta",
    "firstName": "Ad",
    "lastName": "Soyad",
    "address": "Adres",
    "city": "Şehir",
    "postalCode": "Posta kodu",
    "country": "Ülke (3 harfli kod)",
    "payNow": "Şimdi öde",
    "redirecting": "Yönlendiriliyor...",
    "failed": "Ödeme başlatılamadı. Lütfen tekrar deneyin.",
    "stockChanged": "Sepetinizdeki bir ürün tükendi. Lütfen sepetinizi kontrol edin.",
    "successTitle": "Siparişiniz için teşekkürler",
    "keepShopping": "Alışverişe devam et",
    "successBody": "Ödemeniz alındı, makbuzunuzu e-posta ile gönderdik.",
    "cancelTitle": "Ödeme iptal edildi",
    "cancelBody": "Hesabınızdan ücret alınmadı. Sepetiniz olduğu gibi duruyor, dilediğiniz zaman kaldığınız yerden devam edebilirsiniz.",
    "tryAgain": "Ödemeye dön",
    "processing": "Ödemenizi doğruluyoruz. Bu sayfa birazdan kendiliğinden güncellenecek.",
    "orderNumber": "Sipariş {number}",
    "items": "Ürünler",
    "shippingCost": "Kargo",
    "total": "Toplam",
    "shipTo": "Teslimat adresi",
    "createAccountTitle": "Bu siparişi takip edin",
    "createAccountBody": "{email} ile bir hesap oluşturun; e-posta adresinizi doğruladığınızda bu sipariş hesabınıza kaydedilir.",
    "createAccount": "Hesap oluştur",
    "savedToAccount": "Bu sipariş hesabınıza kaydedildi."
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
  "Shop": {
    "title": "المتجر",
    "empty": "لا توجد منتجات بعد."
  },
  "Cart": {
    "title": "السلة",
    "empty": "سلتك فارغة.",
    "badgeLabel": "السلة، {count} منتج",
    "addToCart": "أضف إلى السلة",
    "adding": "جارٍ الإضافة...",
    "added": "تمت الإضافة ✓",
    "addFailed": "تعذّرت إضافة هذا المنتج.",
    "updateFailed": "تعذّر تحديث سلتك.",
    "outOfStock": "غير متوفر",
    "limitedToStock": "لم يتبقَّ سوى القليل، فأضفنا ما أمكن.",
    "maxReached": "تم بلوغ الحد الأقصى",
    "noLongerAvailable": "لم يعد متوفرًا",
    "removeUnavailable": "أزل المنتجات غير المتوفرة للمتابعة.",
    "size": "المقاس",
    "colour": "اللون",
    "increase": "زيادة الكمية",
    "decrease": "تقليل الكمية",
    "remove": "إزالة",
    "clear": "إفراغ السلة",
    "subtotal": "المجموع الفرعي",
    "shippingAtCheckout": "يتم احتساب الشحن عند الدفع.",
    "checkout": "إتمام الشراء",
    "continueShopping": "متابعة التسوق"
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
  },
  "UI": {
    "product": {
      "featuredSauces": "منتجات مختارة",
      "sauce": "منتج",
      "sauces": "منتجات"
    },
    "actions": {
      "viewProducer": "عرض العلامة",
      "visitWebsite": "زيارة الموقع"
    }
  },
  "SauceArchive": {
    "search": {
      "placeholder": "ابحث عن المنتجات",
      "filters": {
        "sauceType": "الفئة",
        "allCategories": "كل الفئات",
        "sort": "ترتيب",
        "sortNewest": "الأحدث",
        "sortPopular": "الأكثر رواجًا",
        "heatLevel": "درجة الحرارة",
        "pepper": "نوع الفلفل",
        "allChilliTypes": "كل أنواع الفلفل",
        "sortMildToHot": "من الخفيف إلى الحار",
        "sortHotToMild": "من الحار إلى الخفيف"
      }
    },
    "results": {
      "showing": "عرض",
      "of": "من",
      "sauces": "منتجات",
      "noResults": "لا توجد نتائج",
      "adjustSearch": "جرّب بحثًا أو عامل تصفية مختلفًا.",
      "loadMore": "تحميل المزيد",
      "clearFilters": "مسح عوامل التصفية"
    }
  },
  "homepage": {
    "producerShowcase": {
      "eyebrow": "العلامات",
      "title": "من يصنعها",
      "viewAll": "عرض الكل",
      "seeMore": "المزيد"
    }
  },
  "Checkout": {
    "title": "الدفع",
    "subtotal": "المجموع الفرعي",
    "shippingNote": "تُضاف تكلفة الشحن في الخطوة التالية.",
    "cartProblem": "سلتك فارغة أو تحتوي على منتجات لم تعد متوفرة.",
    "backToCart": "العودة إلى السلة",
    "email": "البريد الإلكتروني",
    "firstName": "الاسم الأول",
    "lastName": "اسم العائلة",
    "address": "العنوان",
    "city": "المدينة",
    "postalCode": "الرمز البريدي",
    "country": "الدولة (رمز من 3 أحرف)",
    "payNow": "ادفع الآن",
    "redirecting": "جارٍ التحويل...",
    "failed": "تعذّر بدء عملية الدفع. حاول مرة أخرى.",
    "stockChanged": "نفد أحد المنتجات في سلتك. يرجى مراجعة السلة.",
    "successTitle": "شكرًا لطلبك",
    "keepShopping": "متابعة التسوق",
    "successBody": "تمت عملية الدفع بنجاح وأرسلنا الإيصال إلى بريدك.",
    "cancelTitle": "تم إلغاء الدفع",
    "cancelBody": "لم يتم خصم أي مبلغ. سلتك كما تركتها، ويمكنك المتابعة متى شئت.",
    "tryAgain": "العودة إلى الدفع",
    "processing": "نتحقق من عملية الدفع. ستتحدّث هذه الصفحة تلقائيًا خلال لحظات.",
    "orderNumber": "الطلب {number}",
    "items": "المنتجات",
    "shippingCost": "الشحن",
    "total": "الإجمالي",
    "shipTo": "التسليم إلى",
    "createAccountTitle": "تابع هذا الطلب",
    "createAccountBody": "أنشئ حسابًا باستخدام {email} وسيُحفظ هذا الطلب فيه بعد تأكيد بريدك الإلكتروني.",
    "createAccount": "إنشاء حساب",
    "savedToAccount": "تم حفظ هذا الطلب في حسابك."
  }
}
EOF

# 6) Tailwind v4 RTL support
# Tailwind v4 has native rtl:/ltr: variants built-in via the HTML dir attribute.
# No tailwind.config.ts exists in v4; configuration is CSS-based in globals.css.

# 6a) next-intl v4 request config
mkdir -p src/i18n
LOCALES_ARRAY=$(echo "$LOCALES_CSV" | sed "s|,|', '|g")
cat > src/i18n/request.ts <<EOF
import { getRequestConfig } from 'next-intl/server';

const locales = ['$LOCALES_ARRAY'];

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !locales.includes(locale)) {
    locale = '$DEFAULT_LOCALE';
  }
  return {
    locale,
    messages: (await import(\`../messages/\${locale}.json\`)).default,
  };
});
EOF

# 6b) Wire next-intl plugin into next.config.ts
# This replaces the file create-next-app wrote. Keep its Tailwind 4 Turbopack
# loader, otherwise `@import "tailwindcss"` / `@theme` are never processed
# and the store ships without styles (the build only warns about it).
# create-next-app also enables `cacheComponents` and `partialPrefetching`;
# those are left off because the generated pages read cookies/session on
# every request and would need Suspense boundaries first.
cat > next.config.ts <<'EOF'
import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
EOF

# 6b2) Vitest, for the pure logic that ships with the store (heat scale,
# product field parsing, shipping maths). Node environment only: these are
# plain functions, so there is no need for jsdom. The config is .mts so it
# loads as ESM without adding "type": "module" to package.json, which would
# change how Next loads its own config.
cat > vitest.config.mts <<'EOF'
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
EOF

python3 <<'PYPKG'
import json, pathlib
path = pathlib.Path('package.json')
pkg = json.loads(path.read_text())
scripts = pkg.setdefault('scripts', {})
scripts['test'] = 'vitest run'
scripts['test:watch'] = 'vitest'
path.write_text(json.dumps(pkg, indent=2) + "\n")
PYPKG

# 6c) Stub message files for any locale that doesn't have one yet
for loc in $(echo "$LOCALES_CSV" | tr ',' ' '); do
  if [ ! -f "src/messages/${loc}.json" ]; then
    cp src/messages/en.json "src/messages/${loc}.json"
  fi
done

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

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

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

cat > src/components/ui/textarea.tsx <<'EOF'
import * as React from 'react';
import { cn } from '@/lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export { Textarea };
EOF

cat > src/components/ui/select.tsx <<'EOF'
'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-50 min-w-[8rem] overflow-hidden rounded-md border bg-white text-gray-900 shadow-md',
        position === 'popper' && 'translate-y-1',
        className
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-gray-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem };
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

// Browser-side Supabase client. `createClient()` matches the server helper's
// name; `supabase` is a shared instance for client components.
export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

export const supabase = createClient();
EOF

# 8) Locale-aware root layout with RTL/LTR handling
mkdir -p src/app/[locale]
cat > src/app/[locale]/layout.tsx <<'EOF'
import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale, getMessages } from 'next-intl/server';
import '../globals.css';
import type { ReactNode } from 'react';
import Header from '@/components/Header';

const RTL_LOCALES = new Set(['ar', 'fa', 'he', 'ur']);

export const dynamic = 'force-dynamic';

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();
  const dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <NextIntlClientProvider messages={messages}>
          <Header locale={locale} />
          <main>{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
EOF

# 9) Locale root page
cat > src/app/[locale]/page.tsx <<'EOF'
import Link from 'next/link';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-3xl font-bold mb-6">Next Commerce Template</h1>
      <nav className="flex gap-4">
        <Link href={`/${locale}/shop`} className="underline">Shop</Link>
        <Link href={`/${locale}/cart`} className="underline">Cart</Link>
        <Link href={`/${locale}/checkout`} className="underline">Checkout</Link>
        <Link href={`/${locale}/auth/sign-in`} className="underline">Sign in</Link>
        <Link href={`/${locale}/auth/sign-up`} className="underline">Create account</Link>
      </nav>
    </main>
  );
}
EOF

# 10) Minimal shop/cart/checkout pages; checkout protected server-side
mkdir -p src/app/[locale]/shop src/app/[locale]/cart src/app/[locale]/checkout
cat > src/app/[locale]/shop/page.tsx <<'EOF'
import { getTranslations } from 'next-intl/server';

import AddToCartButton from '@/components/cart/AddToCartButton';
import ProductCard from '@/components/store/ProductCard';
import type { StoreProduct } from '@/components/store/types';
import { createClient } from '@/lib/supabase/server';
import { maxAllowedQuantity } from '@/lib/cart/pricing';

export default async function ShopPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Shop' });
  const supabase = await createClient();

  // products_public is the storefront view: it hides supplier fields and
  // only contains published, unarchived rows.
  const { data: products } = await supabase
    .from('products_public')
    .select(
      'id, name, slug, description, image_url, price_cents, currency, stock, track_inventory, allow_backorder, max_order_quantity, size_options, color_options, category_id, category_name, category_slug'
    )
    .order('created_at', { ascending: false });

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>

      {!products?.length ? (
        <p className="text-gray-600">{t('empty')}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((row) => {
            const soldOut =
              maxAllowedQuantity({
                stock: row.stock,
                trackInventory: row.track_inventory,
                allowBackorder: row.allow_backorder,
                maxOrderQuantity: row.max_order_quantity
              }) <= 0;

            const product: StoreProduct = {
              id: row.id,
              name: row.name,
              slug: row.slug,
              description: row.description,
              image_url: row.image_url,
              price_cents: row.price_cents,
              currency: row.currency,
              category: row.category_id
                ? {
                    id: row.category_id,
                    name: row.category_name ?? '',
                    slug: row.category_slug ?? ''
                  }
                : null
            };

            return (
              <li key={row.id}>
                <ProductCard
                  product={product}
                  locale={locale}
                  action={
                    <AddToCartButton
                      locale={locale}
                      productId={row.id}
                      sizeOptions={row.size_options}
                      colorOptions={row.color_options}
                      soldOut={soldOut}
                      className="w-full"
                    />
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
EOF
cat > src/app/[locale]/cart/page.tsx <<'EOF'
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import CartLines from '@/components/cart/CartLines';
import { getCart } from '@/lib/cart/service';
import { formatPrice } from '@/lib/format';

export default async function CartPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Cart' });
  const cart = await getCart();
  const blocked = cart.lines.some((line) => !line.available);

  if (cart.lines.length === 0) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-4 text-2xl font-bold">{t('title')}</h1>
        <p className="text-gray-600">{t('empty')}</p>
        <Link href={`/${locale}/shop`} className="mt-4 inline-block underline">
          {t('continueShopping')}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-2xl font-bold">{t('title')}</h1>

      <CartLines locale={locale} lines={cart.lines} />

      <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
        <span className="text-lg font-semibold">{t('subtotal')}</span>
        <span className="text-lg font-bold">
          {formatPrice(cart.totals.subtotalCents, cart.currency, locale)}
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-500">{t('shippingAtCheckout')}</p>
      {blocked && (
        <p className="mt-2 text-sm text-red-700">{t('removeUnavailable')}</p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {blocked ? (
          <span
            className="cursor-not-allowed rounded-md bg-gray-300 px-5 py-2.5 font-semibold text-gray-600"
            aria-disabled="true"
          >
            {t('checkout')}
          </span>
        ) : (
          <Link
            href={`/${locale}/checkout`}
            className="rounded-md bg-black px-5 py-2.5 font-semibold text-white hover:bg-gray-800"
          >
            {t('checkout')}
          </Link>
        )}
        <Link
          href={`/${locale}/shop`}
          className="rounded-md border border-gray-300 px-5 py-2.5 font-semibold hover:bg-gray-50"
        >
          {t('continueShopping')}
        </Link>
      </div>
    </main>
  );
}
EOF
cat > src/app/[locale]/checkout/page.tsx <<'EOF'
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
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

# 10.5a) Header component (logo + auth state + admin link for shop_owner)
cat > src/components/Header.tsx <<'EOF'
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import CartBadge from '@/components/cart/CartBadge';

export default async function Header({ locale }: { locale: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let isShopOwner = false;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    isShopOwner = profile?.role === 'shop_owner';
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-5xl flex items-center justify-between px-6 py-3">
        <Link href={`/${locale}`} className="font-bold text-lg tracking-tight">
          🌶️ Store
        </Link>

        <nav className="flex items-center gap-5 text-sm">
          <Link href={`/${locale}/shop`} className="text-gray-600 hover:text-gray-900">Shop</Link>
          <CartBadge locale={locale} />

          {isShopOwner && (
            <Link
              href={`/${locale}/admin`}
              className="rounded bg-gray-900 px-3 py-1 text-white hover:bg-gray-700"
            >
              Admin
            </Link>
          )}

          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-gray-500 hidden sm:block">{user.email}</span>
              <form action="/api/auth/sign-out" method="POST">
                <button type="submit" className="text-gray-600 hover:text-gray-900 underline">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Link href={`/${locale}/auth/sign-in`} className="text-gray-600 hover:text-gray-900">Sign in</Link>
              <Link href={`/${locale}/auth/sign-up`} className="rounded bg-black px-3 py-1 text-white hover:bg-gray-800">
                Sign up
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
EOF

# 10.5b) Sign-out API route
mkdir -p src/app/api/auth/sign-out
cat > src/app/api/auth/sign-out/route.ts <<'EOF'
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { clearCartSession } from '@/lib/cart/session';

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Drop the cart cookie too. It is a bearer token for a cart: left behind
  // on a shared machine, the next person to use the browser would see the
  // previous customer's cart and could take it through checkout.
  await clearCartSession();

  const referer = request.headers.get('referer') ?? '/';
  return NextResponse.redirect(referer, { status: 303 });
}
EOF

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
import { mergeGuestCartAction } from '@/lib/cart/actions';

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
    if (error) {
      setErr(error.message);
      return;
    }

    // Keep anything added before signing in, and pull back a cart left on
    // another device.
    await mergeGuestCartAction(locale);
    router.push(`/${locale}`);
    router.refresh();
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

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

// useSearchParams needs a Suspense boundary so the page can still be
// prerendered; the form below is the actual page.
export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const searchParams = useSearchParams();
  // Where to land after the confirmation link. The success page sends
  // guests here with their checkout email and itself as `next`, so that
  // confirming the account brings them straight back to their order.
  // Same-origin paths only: never redirect through a link to somewhere else.
  const requestedNext = searchParams.get('next');
  const next =
    requestedNext && requestedNext.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : null;

  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr('Passwords do not match');
      return;
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: next
          ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
          : `${window.location.origin}/auth/callback`
      },
    });
    if (error) setErr(error.message);
    else setDone(true);
  }

  if (done) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="text-2xl font-bold mb-2">Check your email</h1>
        <p className="text-gray-600">We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account.</p>
      </main>
    );
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

# Auth callback route handler (exchanges Supabase code for session)
mkdir -p src/app/auth/callback
cat > src/app/auth/callback/route.ts <<'EOF'
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/en';

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name) { return cookieStore.get(name)?.value; },
          set(name, value, options) { cookieStore.set({ name, value, ...options }); },
          remove(name, options) { cookieStore.set({ name, value: '', ...options }); },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // The email is confirmed now, so any orders placed as a guest with
      // this address can be attached to the account. Best effort: the
      // success and account pages call it again.
      await supabase.rpc('claim_guest_orders');
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/en/auth/sign-in?error=confirmation_failed`);
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

  // New profiles are always customers; promote the owner via the SQL editor.
  const role = existingProfile?.role || 'customer';

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
ensure_env_default "NEXT_PUBLIC_SITE_URL" "http://localhost:3000"
ensure_env_default "STRIPE_SECRET_KEY" "sk_test_yourkey"
ensure_env_default "STRIPE_WEBHOOK_SECRET" "whsec_yourwebhooksecret"
ensure_env_default "NEXTAUTH_SECRET" "$(openssl rand -hex 32 2>/dev/null || od -An -N32 -tx1 /dev/urandom | tr -d " \n")"

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
echo "  Open http://localhost:3000/$DEFAULT_LOCALE/auth/sign-in and create your account."
echo "  Then promote it in the Supabase SQL editor:"
echo "    update public.profiles set role = 'shop_owner' where id = (select id from auth.users where email = 'you@example.com');"
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
echo "  • New accounts are customers; promote the owner via the SQL editor (see above)"
