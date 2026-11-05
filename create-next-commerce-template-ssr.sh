#!/usr/bin/env bash
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is required (Next.js 16 needs Node 20.9 or newer)." >&2
  exit 1
fi

# Next 16 refuses to run on anything older than 20.9, so fail here with a
# clear message rather than halfway through the scaffold.
if ! node -e 'const [maj, min] = process.versions.node.split(".").map(Number); process.exit(maj > 20 || (maj === 20 && min >= 9) ? 0 : 1)'; then
  echo "❌ Node.js $(node -p 'process.versions.node') is too old: Next.js 16 needs 20.9 or newer." >&2
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
# are still written so they can be pushed later with `npx supabase@3 db push --remote`.
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

# The Supabase CLI is run through npx at a pinned major so the flags below
# match whatever is (or isn't) installed globally. v3 is local-by-default and
# asks before touching a hosted project, hence --remote and --yes on push.
SUPABASE_CLI="npx --yes supabase@3"
if [ "$SKIP_SUPABASE" != "true" ] && ! $SUPABASE_CLI --version >/dev/null 2>&1; then
  echo "❌ Could not run the Supabase CLI (npx supabase@3). Check your network and npm setup." >&2
  exit 1
fi

APP_PATH=${1:-next-commerce-template}
# A path is fine too (the test script generates into its own /tmp
# directory); the shop is named after its last part.
APP_NAME=$(basename "$APP_PATH")
DEFAULT_LOCALE=${2:-en}
LOCALES_CSV=${3:-"en,de,tr,ar"}  # comma-separated

# Locales are BCP 47 tags, lowercase, as they appear in URLs: a language
# ("de") or a language-country market ("de-at", "en-de"). A market falls
# back to its language's messages and only needs the strings that differ.
LOCALES_CSV=$(echo "$LOCALES_CSV" | tr 'A-Z_' 'a-z-' | tr -d ' ')
DEFAULT_LOCALE=$(echo "$DEFAULT_LOCALE" | tr 'A-Z_' 'a-z-' | tr -d ' ')
for loc in $(echo "$LOCALES_CSV" | tr ',' ' '); do
  if ! echo "$loc" | grep -Eq '^[a-z]{2,3}(-[a-z]{2})?$'; then
    echo "❌ Locale '$loc' is not a language ('de') or language-country ('de-at') code." >&2
    exit 1
  fi
done
if ! echo ",$LOCALES_CSV," | grep -q ",$DEFAULT_LOCALE,"; then
  echo "❌ Default locale '$DEFAULT_LOCALE' is not in the locale list '$LOCALES_CSV'." >&2
  exit 1
fi

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
# Every option is stated: --yes falls back to preferences saved from an
# earlier interactive run, so an unstated option could differ per machine.
# Cache Components stay off (every page reads cookies; see ROADMAP), the
# React Compiler is still opt-in upstream, and AGENTS.md is Next's own file.
pnpm create next-app@latest "$APP_PATH" \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --turbopack \
  --no-react-compiler \
  --no-cache-components \
  --no-agents-md \
  --no-agent-feedback \
  --yes

cd "$APP_PATH"

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

# How customers sign in. Admins always use a password (see ensure_admin_mfa
# in a later step for their second factor).
ensure_customer_auth() {
  local existing answer
  existing=$(get_env_var "SHOPFORGE_CUSTOMER_AUTH")
  [ -z "$existing" ] && existing="${SHOPFORGE_CUSTOMER_AUTH:-}"
  if [ -z "$existing" ] && [ "$SKIP_SUPABASE" = "true" ]; then
    existing="password"
  fi
  if [ -z "$existing" ]; then
    echo ""
    echo "🔐 Customer sign-in"
    echo "   1) Password   Customers choose a password at sign-up and can reset"
    echo "                 it by email. Familiar, works with password managers."
    echo "   2) Email code Customers type their email and receive a six-digit"
    echo "                 code to enter. Nothing to remember and nothing to"
    echo "                 reset. (No sign-in links: mail scanners open those"
    echo "                 before the customer does and they stop working.)"
    echo "   The shop owner always signs in with a password."
    read -r -p "   Choice [1]: " answer
    case "$answer" in
      2|otp|code) existing="otp" ;;
      *) existing="password" ;;
    esac
  fi
  case "$existing" in
    password|otp) ;;
    *) echo "⚠️  Unknown SHOPFORGE_CUSTOMER_AUTH '$existing', using password."; existing="password" ;;
  esac
  set_env_var "SHOPFORGE_CUSTOMER_AUTH" "$existing"
  export SHOPFORGE_CUSTOMER_AUTH="$existing"
}

# Whether the shop owner needs an authenticator app as a second factor.
ensure_admin_mfa() {
  local existing answer
  existing=$(get_env_var "SHOPFORGE_ADMIN_MFA")
  [ -z "$existing" ] && existing="${SHOPFORGE_ADMIN_MFA:-}"
  if [ -z "$existing" ] && [ "$SKIP_SUPABASE" = "true" ]; then
    existing="required"
  fi
  if [ -z "$existing" ]; then
    echo ""
    echo "🛡️  Admin two-factor authentication"
    echo "   The admin panel holds your catalogue and every customer's orders."
    echo "   With this on, the owner also needs a code from an authenticator"
    echo "   app (Google Authenticator, Authy, 1Password...) to open /admin."
    echo "   Set up on first visit. Needs TOTP enabled under Authentication →"
    echo "   Multi-Factor in Supabase (it is by default)."
    read -r -p "   Require an authenticator code for the admin? [Y/n]: " answer
    case "$answer" in
      n|N|no|off) existing="off" ;;
      *) existing="required" ;;
    esac
  fi
  case "$existing" in
    required|off) ;;
    *) echo "⚠️  Unknown SHOPFORGE_ADMIN_MFA '$existing', using required."; existing="required" ;;
  esac
  set_env_var "SHOPFORGE_ADMIN_MFA" "$existing"
  export SHOPFORGE_ADMIN_MFA="$existing"
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
# Tiptap is the email designer's text editor (admin pages only).
pnpm add @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-text-style @tiptap/extension-text-align
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
  $SUPABASE_CLI init
fi

echo "🔐 Configuring Supabase credentials..."
prompt_env_var "NEXT_PUBLIC_SUPABASE_URL" "Supabase project URL (https://....supabase.co)" false "https://placeholder.supabase.co"
prompt_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "Supabase anon key" true "placeholder-anon-key"
prompt_env_var "SUPABASE_SERVICE_ROLE_KEY" "Supabase service role key" true "placeholder-service-role-key"
prompt_env_var "SUPABASE_PROJECT_REF" "Supabase project ref (e.g. abcd1234)" false "placeholder"
ensure_store_mode
ensure_customer_auth
ensure_admin_mfa

echo "🧱 Choosing product fields..."
ensure_product_fields
ensure_heat_scale

echo "🗂️  Writing product field config..."
mkdir -p src/lib/products
python3 "$FIELD_PICKER" config \
  "$FIELD_CATALOGUE" "$STORE_MODE" "$SHOPFORGE_PRODUCT_FIELDS" "$HEAT_JSON" \
  src/lib/products/config.ts

echo "🔐 Writing auth config (customer sign-in: $SHOPFORGE_CUSTOMER_AUTH, admin 2FA: $SHOPFORGE_ADMIN_MFA)..."
mkdir -p src/lib/auth
cat > src/lib/auth/config.ts <<EOF
/**
 * Authentication configuration.
 *
 * Written by create-next-commerce-template-ssr.sh from the answers given at
 * generation time. Edit by hand to change it.
 */
export const AUTH_CONFIG = {
  /**
   * How customers sign in.
   * 'password': email and password, with reset by email.
   * 'otp':      email and a six-digit code sent to it; no password exists.
   *             Needs the Supabase "Magic Link" email template to include
   *             {{ .Token }} (see SETUP_GUIDE.md).
   * The shop owner always signs in with a password.
   */
  customerSignIn: '${SHOPFORGE_CUSTOMER_AUTH}' as 'password' | 'otp',

  /**
   * Whether the shop owner must also enter a code from an authenticator
   * app to use the admin. 'required' sends them to /auth/mfa to enrol on
   * first visit and to verify on every new session. 'off' skips it.
   */
  adminMfa: '${SHOPFORGE_ADMIN_MFA}' as 'required' | 'off',
} as const;
EOF

if [ "$SKIP_SUPABASE" = "true" ]; then
  echo "🔗 Skipping Supabase link (--skip-supabase)."
else
echo "🔗 Linking Supabase project..."
# Attempt to list projects to check login status
if ! $SUPABASE_CLI projects list >/dev/null 2>&1; then
  echo "🔑 Not logged into Supabase. Please log in."
  $SUPABASE_CLI login
else
  # Check if the project ref is accessible with the current login
  if ! $SUPABASE_CLI projects list | grep -q "$SUPABASE_PROJECT_REF"; then
    echo "⚠️  Current Supabase account doesn't have access to project $SUPABASE_PROJECT_REF."
    echo "   The project may belong to a different Supabase account."
    read -r -p "Log out and log in with the correct account? [Y/n]: " login_again
    if [[ $login_again =~ ^[Yy]$ ]] || [ -z "$login_again" ]; then
      $SUPABASE_CLI logout
      $SUPABASE_CLI login
    else
      echo "⚠️  Continuing with current account, but 'supabase link' may fail."
    fi
  fi
fi

# Link the project (will prompt for database password)
$SUPABASE_CLI link --project-ref "$SUPABASE_PROJECT_REF"
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

# 4. Storage Policies (Standard for all templates): public read, owner-only
# writes. Kept in lib/ so test/check-schema.sh can test them too.
cp "$SCRIPT_DIR/lib/storage-policies.sql" supabase/migrations/0004_storage_policies.sql

if [ "$SKIP_SUPABASE" = "true" ]; then
  echo "🗄️ Migrations written to supabase/migrations (not pushed: --skip-supabase)."
  echo "   Later: fill in .env.local, then 'npx supabase@3 init && npx supabase@3 link --project-ref <ref> && npx supabase@3 db push --remote'."
else
  echo "🗄️ Pushing all migrations to Supabase..."
  $SUPABASE_CLI db push --remote --yes
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

import { DEFAULT_LOCALE, LOCALES } from './i18n/config';

/**
 * Locale routing. Every page lives under a locale prefix; only the bare
 * root is redirected, once, to the best match for Accept-Language. A
 * prefixed URL is never redirected: Googlebot crawls from the US with no
 * Accept-Language, so a geo-redirect would hide every other locale from
 * it. hreflang links are rendered by the pages themselves (one source of
 * truth with the sitemap), so next-intl's Link-header alternates are off.
 */
export default createMiddleware({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  alternateLinks: false
});

export const config = {
  matcher: ['/((?!_next|api|auth/callback|sitemap.xml|robots.txt|.*\\..*).*)']
};
EOF
# inject locales/default

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
    "Account": "Account",
    "Home": "Home"
  },
  "Account": {
    "ordersTitle": "Your orders",
    "noOrders": "You have not placed any orders yet.",
    "startShopping": "Start shopping",
    "orderNumber": "Order {number}",
    "total": "Total",
    "discount": "Discount ({code})",
    "shippedOn": "Shipped on {date}",
    "trackingNumber": "Tracking number {number}",
    "track": "Track your parcel",
    "refundedAmount": "{amount} refunded",
    "status": {
      "pending": "Pending",
      "paid": "Paid",
      "fulfilled": "Shipped",
      "cancelled": "Cancelled",
      "refunded": "Refunded"
    }
  },
  "Shop": {
    "title": "Shop",
    "empty": "No products yet."
  },
  "Product": {
    "backToShop": "Back to shop",
    "noImage": "No image yet",
    "imageAlt": "{name}, image {index} of {count}",
    "galleryLabel": "Product images",
    "showImage": "Show image {index} of {count}",
    "wasPrice": "Was {price}",
    "inStock": "In stock",
    "lowStock": "Only {count} left",
    "backorder": "Available to order, ships when back in stock",
    "soldOut": "Sold out",
    "brand": "Brand",
    "category": "Category",
    "tags": "Tags",
    "about": "About this product",
    "facts": "Product details",
    "netContent": "Net content",
    "weight": "Weight",
    "dimensions": "Dimensions",
    "countryOfOrigin": "Country of origin",
    "ingredients": "Ingredients",
    "allergens": "Allergens",
    "dietary": "Dietary",
    "storage": "Storage",
    "bestBefore": "Best before",
    "nutritionTitle": "Nutrition per 100 g / ml",
    "nutrition": {
      "energy_kj": "Energy (kJ)",
      "energy_kcal": "Energy (kcal)",
      "fat_g": "Fat (g)",
      "saturated_fat_g": "of which saturates (g)",
      "carbohydrate_g": "Carbohydrate (g)",
      "sugar_g": "of which sugars (g)",
      "protein_g": "Protein (g)",
      "salt_g": "Salt (g)"
    },
    "dietaryFlags": {
      "vegan": "Vegan",
      "vegetarian": "Vegetarian",
      "gluten-free": "Gluten-free",
      "dairy-free": "Dairy-free",
      "nut-free": "Nut-free",
      "organic": "Organic"
    },
    "units": {
      "pieces": "pieces"
    },
    "heat": "Heat",
    "heatMeter": "Heat {level} of {max}",
    "scoville": "{shu} SHU",
    "chilliTypes": "Chilli types"
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
    "quantity": "Quantity",
    "increase": "Increase quantity",
    "decrease": "Decrease quantity",
    "remove": "Remove",
    "clear": "Empty cart",
    "subtotal": "Subtotal",
    "shippingAtCheckout": "Shipping is calculated at checkout.",
    "checkout": "Checkout",
    "continueShopping": "Continue shopping",
    "discount": {
      "label": "Promo code",
      "placeholder": "Enter code",
      "apply": "Apply",
      "applying": "Checking...",
      "remove": "Remove",
      "applied": "Code {code} applied",
      "line": "Discount ({code})",
      "shipping": "Shipping",
      "freeShipping": "Free with {code}",
      "total": "Total",
      "errors": {
        "invalid_format": "That doesn't look like a code. Codes are 3 to 32 letters, numbers, dashes or underscores.",
        "not_found": "We don't recognise that code. Check the spelling and try again.",
        "inactive": "That code is no longer active.",
        "not_started": "That code isn't valid yet.",
        "expired": "That code has expired.",
        "exhausted": "That code has been used as many times as it can be.",
        "min_subtotal": "That code needs an order of at least {minimum}.",
        "currency_mismatch": "That code is for a different currency.",
        "nothing_to_discount": "Shipping is already free on this order, so that code wouldn't change anything.",
        "failed": "We couldn't apply that code just now. Please try again."
      }
    }
  },
  "Admin": {
    "title": "Store admin",
    "dashboardHeading": "Manage your catalogue",
    "dashboardWelcomeHeading": "You're in control",
    "dashboardWelcomeCopy": "Use the admin panel to add new sauces, edit listings, and keep imagery fresh.",
    "nav": {
      "dashboard": "Dashboard",
      "products": "Products",
      "newProduct": "New product",
      "orders": "Orders",
      "discounts": "Discount codes",
      "seo": "Search & Merchant Center",
      "email": "Email"
    },
    "stats": {
      "products": "Products",
      "brands": "Brands",
      "categories": "Categories"
    },
    "orders": {
      "heading": "Orders",
      "subheading": "Every paid order, newest first. Open an order to refund it through Stripe.",
      "order": "Order {number}",
      "status": "Status",
      "save": "Save",
      "tracking": "Tracking (optional, saved when the status is Shipped)",
      "carrier": "Carrier",
      "trackingNumber": "Tracking number",
      "trackingUrl": "Tracking link",
      "trackingUrlHint": "Leave empty to use the carrier's page for known carriers.",
      "autoEmailHint": "Setting the status to Shipped emails the customer once. Changing it back and forth does not email again.",
      "shippedOn": "Shipped {date}",
      "customerNotified": "Customer emailed {date}",
      "customerNotNotified": "Customer not emailed about shipping",
      "sendShippingEmail": "Send shipping email",
      "resendShippingEmail": "Resend shipping email",
      "shippingEmailSent": "Shipping email sent to {email}.",
      "shippingEmailOff": "Email is not configured, so no shipping email was sent.",
      "shippingEmailFailed": "The shipping email could not be sent: {error}",
      "statusSaved": "Status saved.",
      "statusFailed": "The status could not be saved: {error}",
      "total": "Total",
      "discount": "Discount ({code})",
      "refundedSoFar": "{amount} refunded",
      "details": "Details and refunds",
      "empty": "No orders yet."
    },
    "refund": {
      "heading": "Refund",
      "subheading": "The money goes back through Stripe to the card the customer paid with. This cannot be undone.",
      "backToOrders": "Back to orders",
      "remaining": "Available to refund: {amount}",
      "nothingLeft": "This order has been fully refunded.",
      "notRefundable": "Only paid or shipped orders can be refunded.",
      "noPayment": "This order has no Stripe payment to refund.",
      "kind": "What to refund",
      "kindFull": "The rest of the order ({amount})",
      "kindItems": "Selected items",
      "kindPercent": "A percentage of the order total",
      "kindAmount": "A specific amount",
      "itemQuantity": "Units to refund",
      "itemRefunded": "{count} already refunded",
      "percentLabel": "Percent of {total}",
      "amountLabel": "Amount in {currency}",
      "reason": "Note to the customer (optional)",
      "reasonHint": "Included in the refund email.",
      "preview": "Refund amount: {amount}",
      "confirmLabel": "Type {word} to confirm",
      "submit": "Refund {amount}",
      "submitting": "Refunding...",
      "success": "Refunded {amount}. Stripe refund {id}.",
      "emailSent": "The customer has been emailed.",
      "emailOff": "Email is not configured, so the customer was not notified.",
      "emailFailed": "The customer could not be emailed: {error}",
      "errors": {
        "not_authorized": "You are not allowed to do that.",
        "not_confirmed": "Type {word} to confirm the refund.",
        "not_found": "Order not found.",
        "no_payment": "This order has no Stripe payment to refund.",
        "not_refundable": "Only paid or shipped orders can be refunded.",
        "nothing_left": "This order has been fully refunded.",
        "no_items": "Choose at least one item.",
        "unknown_item": "One of the items is not on this order.",
        "item_quantity": "You cannot refund more units than were ordered.",
        "bad_percent": "Enter a percentage between 0 and 100.",
        "bad_amount": "Enter an amount greater than zero.",
        "exceeds_remaining": "That is more than what is left to refund.",
        "stripe": "Stripe refused the refund: {message}",
        "failed": "The refund could not be recorded: {message}"
      },
      "history": "Refund history",
      "historyEmpty": "No refunds yet.",
      "kinds": {
        "full": "Rest of the order",
        "items": "Items",
        "percent": "{percent}% of the total",
        "amount": "Amount"
      },
      "statuses": {
        "pending": "Pending",
        "succeeded": "Refunded",
        "failed": "Failed"
      },
      "customerEmailed": "Customer emailed",
      "customerNotEmailed": "Customer not emailed"
    },
    "discounts": {
      "heading": "Discount codes",
      "subheading": "Percent and amount codes are created in Stripe too and applied by Stripe at checkout. Free-shipping codes are applied by the shop. A code is checked when the customer enters it and again when they pay.",
      "newHeading": "New code",
      "code": "Code",
      "codeHint": "3 to 32 letters, numbers, dashes or underscores. Customers type it exactly; case does not matter.",
      "kind": "Type",
      "kinds": {
        "percent": "Percentage off",
        "amount": "Amount off",
        "free_shipping": "Free shipping"
      },
      "percent": "Percent off",
      "amount": "Amount off",
      "currency": "Currency (three letters, e.g. EUR)",
      "minSubtotal": "Minimum order (optional)",
      "startsAt": "Valid from (optional)",
      "endsAt": "Valid until (optional)",
      "maxRedemptions": "Maximum uses (optional)",
      "create": "Create code",
      "creating": "Creating...",
      "created": "Code {code} created.",
      "empty": "No codes yet.",
      "columns": {
        "code": "Code",
        "value": "Value",
        "restrictions": "Restrictions",
        "uses": "Uses",
        "status": "Status",
        "actions": "Actions"
      },
      "status": {
        "active": "Active",
        "scheduled": "Scheduled",
        "expired": "Expired",
        "exhausted": "Used up",
        "retired": "Retired"
      },
      "retire": "Retire",
      "reactivate": "Reactivate",
      "delete": "Delete",
      "deleteConfirm": "Delete this code? Only codes that were never used can be deleted.",
      "retired": "Code {code} retired. Customers can no longer use it.",
      "reactivated": "Code {code} is active again.",
      "deleted": "Code {code} deleted.",
      "usesOf": "{count} of {max}",
      "minLabel": "min. {amount}",
      "from": "from {date}",
      "until": "until {date}",
      "noRestrictions": "None",
      "errors": {
        "code_format": "Codes are 3 to 32 letters, numbers, dashes or underscores.",
        "kind": "Choose a type.",
        "percent": "Enter a percentage above 0 and up to 100.",
        "amount": "Enter an amount above zero, e.g. 5 or 7.50.",
        "currency": "Enter a three-letter currency code, e.g. EUR. Amount codes and minimums need one.",
        "min_subtotal": "Enter the minimum as an amount, e.g. 20 or 20.00.",
        "dates": "Check the dates: the end must be after the start.",
        "max_redemptions": "Enter a whole number above zero.",
        "duplicate": "That code already exists.",
        "stripe": "Stripe refused the code: {message}",
        "failed": "The code could not be saved: {message}",
        "in_use": "This code has been used, so it cannot be deleted. Retire it instead.",
        "not_found": "Code not found.",
        "not_authorized": "You are not allowed to do that."
      }
    },
    "seo": {
      "heading": "Search and Merchant Center",
      "subheading": "What Google needs from this shop, and where to paste it. Every public page already carries canonical, hreflang and structured data; this page is the operational side.",
      "siteUrl": "Public site URL",
      "siteUrlHint": "Set NEXT_PUBLIC_SITE_URL in the environment. Every canonical link, hreflang link, sitemap entry and feed URL is built from it, so it must be the exact production origin.",
      "verification": "Google site verification",
      "verified": "Meta tag is rendered (NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION is set).",
      "notVerified": "Not set. Add the HTML-tag verification code from Search Console as NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION.",
      "sitemap": "Sitemap",
      "sitemapHint": "Submit this in Search Console. It lists every locale version of every indexable page with hreflang alternates.",
      "feeds": "Merchant Center product feeds",
      "feedsHint": "One feed per locale. In Merchant Center add a product source from a file hosted at a URL, one per target country and language, and point it here. Google fetches it every 24 hours. Turn on automatic item updates so the page's structured data corrects a stale price instead of the item being disapproved.",
      "feedFor": "Feed for {locale}",
      "locales": "Locales",
      "localesHint": "Each one is a URL prefix with its own canonical and hreflang set. A language-country locale (de-at) inherits its language's text and only overrides what differs.",
      "checklist": "Checklist",
      "steps": {
        "verify": "Verify the site in Search Console and claim it in Merchant Center with the same Google account.",
        "sitemap": "Submit the sitemap in Search Console.",
        "feeds": "Add one product source per target country in Merchant Center using the feed URLs above, or let Merchant Center read the product pages' structured data directly.",
        "identifiers": "Fill in brand, SKU and barcode (GTIN) on products: Google disapproves products with invalid identifiers and ranks ones without them lower.",
        "shipping": "Configure shipping and return policies in Merchant Center; it prefers those over structured data.",
        "currency": "Prices and currency on the pages must match the feed for each target country. Never switch currency by visitor location."
      }
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
    },
    "email": {
      "heading": "Email campaigns",
      "subheading": "Templates for newsletters and offers. Preview them in each of the shop's languages and send yourself a test before anything goes to customers.",
      "comingSoon": "Sending to subscribers is on its way; until then, send yourself a test from any template.",
      "notConfigured": "Test sends need RESEND_API_KEY and EMAIL_FROM in the shop's environment. Previews work without them.",
      "newHeading": "New template",
      "name": "Name",
      "starter": "Start from",
      "starters": {
        "blank": "Blank",
        "newsletter": "Newsletter"
      },
      "create": "Create template",
      "creating": "Creating…",
      "empty": "No templates yet. Create one above.",
      "columns": {
        "name": "Name",
        "updated": "Last edited",
        "lastTest": "Last test",
        "actions": "Actions"
      },
      "never": "Never",
      "duplicate": "Duplicate",
      "delete": "Delete",
      "confirmDelete": "Delete the template “{name}”? This cannot be undone.",
      "copySuffix": "(copy)",
      "notices": {
        "created": "Template “{name}” created.",
        "duplicated": "Copied as “{name}”.",
        "deleted": "Template “{name}” deleted."
      },
      "errors": {
        "name": "Give the template a name of up to 120 characters.",
        "document": "The template has {count, plural, one {# problem} other {# problems}} and was not saved.",
        "tooLarge": "The template is too large to save.",
        "starter": "Choose a layout to start from.",
        "notFound": "That template no longer exists.",
        "notAuthorized": "Only the shop owner can do that.",
        "failed": "Something went wrong: {message}"
      },
      "back": "All templates",
      "save": "Save",
      "saving": "Saving…",
      "language": "Language",
      "subject": "Subject",
      "preheader": "Preview text",
      "noPreheader": "None",
      "preview": {
        "heading": "Preview",
        "desktop": "Desktop",
        "phone": "Phone",
        "frameTitle": "Email preview, {width} pixels wide",
        "sampleNote": "Merge tags show a sample subscriber called {name}. Until the subscriber list exists, the unsubscribe link points to the shop's home page."
      },
      "renderFailed": {
        "invalidDocument": "This template cannot be read: {issues}",
        "empty": "This template has nothing to show in this language yet."
      },
      "warningsHeading": "Worth a look",
      "noWarnings": "Nothing to fix in this language.",
      "warningIn": "{message} (block {block})",
      "warnings": {
        "invalidBlock": "A block could not be read and is left out.",
        "blockFailed": "A block failed to render and is left out.",
        "missingTranslation": "Not translated into this language yet, so the {language} text is shown.",
        "emptyBlock": "Has no text in this language, so it is left out.",
        "missingProduct": "The product is no longer in the shop, so this block is left out.",
        "missingDiscount": "The code {detail} is retired, expired or used up, so this block is left out.",
        "unknownMergeTag": "Unknown merge tag “{detail}”; its fallback text is used.",
        "unsafeUrl": "A link that is not http(s) or mailto was removed: {detail}",
        "missingUnsubscribe": "There is no unsubscribe link."
      },
      "test": {
        "heading": "Send a test",
        "intro": "Sends this template to one address with [Test] in the subject. Merge tags use the sample subscriber.",
        "to": "Send to",
        "language": "Language",
        "send": "Send test",
        "sending": "Sending…",
        "subjectPrefix": "[Test]",
        "result": {
          "sent": "Sent to {to}. Resend message id: {id}.",
          "notConfigured": "Not sent: email is not configured (RESEND_API_KEY and EMAIL_FROM).",
          "providerError": "Resend did not accept the email: {error}",
          "invalidTemplate": "Not sent: the template cannot be read.",
          "empty": "Not sent: nothing is left to show in this language.",
          "invalidRecipient": "That does not look like an email address.",
          "invalidLocale": "That language is not one of the shop's.",
          "tooSoon": "A test of this template went out a moment ago. Wait a few seconds and try again.",
          "notFound": "That template no longer exists.",
          "notAuthorized": "Only the shop owner can send tests.",
          "failed": "Something went wrong: {error}"
        },
        "details": "{duration} ms, {count, plural, =0 {no warnings} one {# warning} other {# warnings}}",
        "logged": "Logged to {file}",
        "notLogged": "Not logged: {error}"
      },
      "designer": {
        "undo": "Undo",
        "redo": "Redo",
        "saveBlocked": "{count, plural, one {# problem} other {# problems}} to fix before saving.",
        "unsaved": "Unsaved changes",
        "saved": "All changes saved",
        "reset": "This template could not be read, so you are starting from an empty email. Saving replaces it.",
        "dropped": "{count, plural, one {# block} other {# blocks}} could not be read and {count, plural, one {was} other {were}} left out. Saving keeps the rest.",
        "settingsHeading": "Email settings",
        "problems": "{count, plural, one {# problem} other {# problems}}",
        "addBlock": "Add a block",
        "previewWaiting": "The preview appears once the email has a subject in the main language.",
        "testUsesSaved": "Tests send the last saved version. Save first to test your changes.",
        "editingLanguage": "Language",
        "defaultLanguage": "{locale} (main)",
        "missingCount": "{count, plural, one {# field} other {# fields}} not translated",
        "untranslatedBadge": "Not translated",
        "notTranslated": "Not translated yet: readers in this language see the {language} text.",
        "copyFrom": "Start from the {language} text",
        "addToColumn": "Add to column {number}",
        "dropHere": "Drop here",
        "empty": "This email is empty. Add a block to start.",
        "linkInvalid": "Start the address with https://, http:// or mailto:",
        "blocks": {
          "heading": "Heading",
          "text": "Text",
          "image": "Image",
          "button": "Button",
          "product": "Product",
          "discount": "Discount code",
          "divider": "Divider",
          "spacer": "Space",
          "columns": "Columns"
        },
        "blockHints": {
          "heading": "A title in large letters",
          "text": "Paragraphs with bold, links, lists and colours",
          "image": "A picture, linked if you like",
          "button": "A link people tap",
          "product": "A product with its picture, price and a button",
          "discount": "A code to enter at checkout",
          "divider": "A thin line",
          "spacer": "Empty space",
          "columns": "Two or three blocks side by side"
        },
        "newBlock": {
          "heading": "A new heading",
          "text": "Write something here.",
          "button": "Shop now"
        },
        "actions": {
          "drag": "Drag to move",
          "moveUp": "Move up",
          "moveDown": "Move down",
          "duplicate": "Duplicate",
          "remove": "Remove"
        },
        "links": {
          "home": "Shop home page",
          "shop": "All products"
        },
        "mergeTags": {
          "button": "Personal details",
          "fallbackName": "there",
          "subscriber_first_name": "First name",
          "subscriber_email": "Their email address",
          "shop_name": "Shop name",
          "shop_url": "Shop address",
          "shop_locale_url": "Shop address in their language",
          "unsubscribe_url": "Unsubscribe link",
          "current_year": "Current year"
        },
        "toolbar": {
          "style": "Text style",
          "paragraph": "Normal text",
          "heading1": "Large heading",
          "heading2": "Medium heading",
          "heading3": "Small heading",
          "bold": "Bold",
          "italic": "Italic",
          "underline": "Underline",
          "strike": "Strikethrough",
          "fontSize": "Text size",
          "defaultSize": "Size",
          "color": "Text colour",
          "defaultColor": "Colour",
          "brandColor": "Brand colour",
          "bulletList": "Bulleted list",
          "orderedList": "Numbered list",
          "alignLeft": "Align left",
          "alignCenter": "Centre",
          "alignRight": "Align right",
          "link": "Link",
          "unlink": "Remove link",
          "linkPlaceholder": "https://…",
          "linkShop": "All products",
          "apply": "Apply",
          "cancel": "Cancel",
          "linkInvalid": "Start the address with https://, http:// or mailto:"
        },
        "fields": {
          "subject": "Subject",
          "subjectHint": "What people see in their inbox.",
          "preheader": "Preview text",
          "preheaderHint": "Shown after the subject in most inboxes.",
          "footer": "Footer",
          "footerHint": "Your business name and postal address. Many countries require them in marketing email.",
          "headingText": "Heading",
          "level": "Size",
          "levels": {
            "1": "Large",
            "2": "Medium",
            "3": "Small"
          },
          "align": "Alignment",
          "aligns": {
            "start": "Start",
            "center": "Centre",
            "end": "End"
          },
          "imageUrl": "Image",
          "chooseImage": "Upload an image or paste its https:// address.",
          "upload": "Upload an image",
          "uploading": "Uploading…",
          "uploadFailed": "The upload failed: {message}",
          "alt": "Description",
          "altHint": "Read out to people who cannot see images, and shown when images are blocked.",
          "link": "Link",
          "linkOptional": "Link (optional)",
          "width": "Width",
          "label": "Label",
          "color": "Colour",
          "useBrandColor": "Use the brand colour",
          "defaultColor": "Default colour",
          "fullWidth": "Full width",
          "product": "Product",
          "chooseProduct": "Choose a product from the list or search for one.",
          "productMissing": "This product is no longer in the shop. Choose another.",
          "searchProducts": "Search products",
          "noProducts": "No products found.",
          "showPrice": "Show the price",
          "buttonLabel": "Button label",
          "leaveEmptyFor": "Leave empty for “{text}”.",
          "discount": "Code",
          "chooseDiscount": "Choose a code",
          "noDiscounts": "There are no live discount codes. Create one under Discount codes first.",
          "discountScheduled": "{code} (starts later)",
          "discountMissing": "The code {code} is retired, expired or used up. Choose another.",
          "title": "Title",
          "note": "Note",
          "height": "Height",
          "layout": "Layout",
          "layouts": {
            "1-1": "Two equal",
            "1-2": "Narrow and wide",
            "2-1": "Wide and narrow",
            "1-1-1": "Three equal"
          },
          "stackOnMobile": "One under the other on phones",
          "column": "Column {number}",
          "emptyColumn": "Nothing here yet."
        },
        "theme": {
          "heading": "Look",
          "brandColor": "Brand colour",
          "textColor": "Text",
          "backgroundColor": "Background",
          "contentColor": "Email body",
          "font": "Font",
          "fonts": {
            "system": "Modern",
            "sans": "Classic sans-serif",
            "serif": "Serif"
          },
          "logo": "Logo",
          "logoWidth": "Logo width",
          "removeLogo": "Remove the logo"
        }
      }
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
        "heatChip": "Heat: {value}",
        "categoryChip": "Category: {value}",
        "allChilliTypes": "All chilli types",
        "sortMildToHot": "Mild to hot",
        "sortHotToMild": "Hot to mild"
      }
    },
    "results": {
      "noResults": "No matches",
      "adjustSearch": "Try a different search or filter.",
      "showingCount": "Showing {shown} of {total} products",
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
    "country": "Country",
    "selectCountry": "Choose a country",
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
    "discount": "Discount ({code})",
    "freeShipping": "Free shipping ({code})",
    "discountInvalid": "Your promo code no longer applies and has been removed. Please check your total before paying.",
    "total": "Total",
    "shipTo": "Delivering to",
    "createAccountTitle": "Keep track of this order",
    "createAccountBody": "Create an account with {email} and this order will be saved to it once you confirm your email address.",
    "createAccount": "Create account",
    "savedToAccount": "This order is saved to your account.",
    "addressAtStripe": "You will enter your delivery address on the secure payment page."
  },
  "Email": {
    "shipping": {
      "subject": "{shop}: order {reference} has shipped",
      "headline": "Your order is on its way",
      "intro": "Good news: order {reference} has been handed to the carrier.",
      "tracking": "Tracking",
      "carrier": "Carrier",
      "trackingNumber": "Tracking number",
      "track": "Track your parcel",
      "items": "In the parcel",
      "address": "Delivering to",
      "viewOrders": "View your orders",
      "footer": "Questions? Just reply to this email."
    },
    "confirmation": {
      "subject": "{shop}: order {reference} confirmed",
      "headline": "Thank you for your order",
      "order": "Order {reference}",
      "subtotal": "Subtotal",
      "shipping": "Shipping",
      "discount": "Discount",
      "total": "Total",
      "address": "Delivery address",
      "viewOrder": "View your order",
      "footer": "We will email you again when your order ships."
    },
    "refund": {
      "subject": "{shop}: refund of {amount} for order {reference}",
      "headlineFull": "Your order has been refunded",
      "headlinePartial": "A refund is on its way",
      "summaryFull": "We have refunded the full {total} for order {reference}.",
      "summaryPartial": "We have refunded {amount} of order {reference}.",
      "refundedSoFar": "Refunded so far: {refunded} of {total}.",
      "viewOrders": "View your orders",
      "footer": "The money goes back to the card or account you paid with. Banks usually show it within 5 to 10 working days."
    },
    "campaign": {
      "footerReason": "You are receiving this email because you subscribed to news from {shop}.",
      "unsubscribe": "Unsubscribe",
      "viewProduct": "View product",
      "discountTitle": "Your code",
      "discountHint": "Enter it in your cart or at checkout.",
      "discountPercent": "{percent}% off",
      "discountAmount": "{amount} off",
      "discountFreeShipping": "Free shipping"
    }
  },
  "Home": {
    "__after__": "Nav",
    "tagline": "Welcome to {shop}",
    "browse": "Browse the shop"
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
    "Account": "Konto",
    "Home": "Startseite"
  },
  "Account": {
    "ordersTitle": "Ihre Bestellungen",
    "noOrders": "Sie haben noch keine Bestellungen aufgegeben.",
    "startShopping": "Jetzt einkaufen",
    "orderNumber": "Bestellung {number}",
    "total": "Gesamt",
    "discount": "Rabatt ({code})",
    "shippedOn": "Versandt am {date}",
    "trackingNumber": "Sendungsnummer {number}",
    "track": "Sendung verfolgen",
    "refundedAmount": "{amount} erstattet",
    "status": {
      "pending": "Ausstehend",
      "paid": "Bezahlt",
      "fulfilled": "Versandt",
      "cancelled": "Storniert",
      "refunded": "Erstattet"
    }
  },
  "Shop": {
    "title": "Shop",
    "empty": "Noch keine Produkte."
  },
  "Product": {
    "backToShop": "Zurück zum Shop",
    "noImage": "Noch kein Bild",
    "imageAlt": "{name}, Bild {index} von {count}",
    "galleryLabel": "Produktbilder",
    "showImage": "Bild {index} von {count} anzeigen",
    "wasPrice": "Vorher {price}",
    "inStock": "Auf Lager",
    "lowStock": "Nur noch {count} verfügbar",
    "backorder": "Bestellbar, wird geliefert, sobald wieder auf Lager",
    "soldOut": "Ausverkauft",
    "brand": "Marke",
    "category": "Kategorie",
    "tags": "Schlagwörter",
    "about": "Über dieses Produkt",
    "facts": "Produktdetails",
    "netContent": "Inhalt",
    "weight": "Gewicht",
    "dimensions": "Maße",
    "countryOfOrigin": "Herkunftsland",
    "ingredients": "Zutaten",
    "allergens": "Allergene",
    "dietary": "Ernährung",
    "storage": "Lagerung",
    "bestBefore": "Mindestens haltbar bis",
    "nutritionTitle": "Nährwerte je 100 g / ml",
    "nutrition": {
      "energy_kj": "Energie (kJ)",
      "energy_kcal": "Energie (kcal)",
      "fat_g": "Fett (g)",
      "saturated_fat_g": "davon gesättigte Fettsäuren (g)",
      "carbohydrate_g": "Kohlenhydrate (g)",
      "sugar_g": "davon Zucker (g)",
      "protein_g": "Eiweiß (g)",
      "salt_g": "Salz (g)"
    },
    "dietaryFlags": {
      "vegan": "Vegan",
      "vegetarian": "Vegetarisch",
      "gluten-free": "Glutenfrei",
      "dairy-free": "Milchfrei",
      "nut-free": "Nussfrei",
      "organic": "Bio"
    },
    "units": {
      "pieces": "Stück"
    },
    "heat": "Schärfe",
    "heatMeter": "Schärfe {level} von {max}",
    "scoville": "{shu} SHU",
    "chilliTypes": "Chilisorten"
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
    "quantity": "Menge",
    "increase": "Menge erhöhen",
    "decrease": "Menge verringern",
    "remove": "Entfernen",
    "clear": "Warenkorb leeren",
    "subtotal": "Zwischensumme",
    "shippingAtCheckout": "Versandkosten werden an der Kasse berechnet.",
    "checkout": "Zur Kasse",
    "continueShopping": "Weiter einkaufen",
    "discount": {
      "label": "Gutscheincode",
      "placeholder": "Code eingeben",
      "apply": "Einlösen",
      "applying": "Wird geprüft...",
      "remove": "Entfernen",
      "applied": "Code {code} eingelöst",
      "line": "Rabatt ({code})",
      "shipping": "Versand",
      "freeShipping": "Kostenlos mit {code}",
      "total": "Gesamt",
      "errors": {
        "invalid_format": "Das sieht nicht nach einem Code aus. Codes bestehen aus 3 bis 32 Buchstaben, Ziffern, Binde- oder Unterstrichen.",
        "not_found": "Diesen Code kennen wir nicht. Bitte prüfen Sie die Schreibweise.",
        "inactive": "Dieser Code ist nicht mehr aktiv.",
        "not_started": "Dieser Code ist noch nicht gültig.",
        "expired": "Dieser Code ist abgelaufen.",
        "exhausted": "Dieser Code wurde bereits so oft eingelöst wie möglich.",
        "min_subtotal": "Dieser Code gilt erst ab einem Bestellwert von {minimum}.",
        "currency_mismatch": "Dieser Code gilt für eine andere Währung.",
        "nothing_to_discount": "Der Versand ist bei dieser Bestellung bereits kostenlos, der Code würde nichts ändern.",
        "failed": "Der Code konnte gerade nicht eingelöst werden. Bitte versuchen Sie es erneut."
      }
    }
  },
  "Admin": {
    "title": "Store admin",
    "dashboardHeading": "Manage your catalogue",
    "dashboardWelcomeHeading": "You're in control",
    "dashboardWelcomeCopy": "Use the admin panel to add new sauces, edit listings, and keep imagery fresh.",
    "nav": {
      "dashboard": "Dashboard",
      "products": "Products",
      "newProduct": "New product",
      "orders": "Bestellungen",
      "discounts": "Gutscheincodes",
      "seo": "Suche & Merchant Center",
      "email": "E-Mail"
    },
    "stats": {
      "products": "Products",
      "brands": "Brands",
      "categories": "Categories"
    },
    "orders": {
      "heading": "Bestellungen",
      "subheading": "Alle bezahlten Bestellungen, neueste zuerst. Öffnen Sie eine Bestellung, um sie über Stripe zu erstatten.",
      "order": "Bestellung {number}",
      "status": "Status",
      "save": "Speichern",
      "tracking": "Sendungsverfolgung (optional, wird beim Status „Versandt“ gespeichert)",
      "carrier": "Versanddienst",
      "trackingNumber": "Sendungsnummer",
      "trackingUrl": "Tracking-Link",
      "trackingUrlHint": "Leer lassen, um bei bekannten Diensten deren Seite zu verwenden.",
      "autoEmailHint": "Der Status „Versandt“ benachrichtigt den Kunden einmal per E-Mail. Ein Hin- und Herwechseln löst keine weitere E-Mail aus.",
      "shippedOn": "Versandt {date}",
      "customerNotified": "Kunde benachrichtigt {date}",
      "customerNotNotified": "Kunde nicht über den Versand benachrichtigt",
      "sendShippingEmail": "Versand-E-Mail senden",
      "resendShippingEmail": "Versand-E-Mail erneut senden",
      "shippingEmailSent": "Versand-E-Mail an {email} gesendet.",
      "shippingEmailOff": "E-Mail ist nicht eingerichtet, es wurde keine Versand-E-Mail gesendet.",
      "shippingEmailFailed": "Die Versand-E-Mail konnte nicht gesendet werden: {error}",
      "statusSaved": "Status gespeichert.",
      "statusFailed": "Der Status konnte nicht gespeichert werden: {error}",
      "total": "Gesamt",
      "discount": "Rabatt ({code})",
      "refundedSoFar": "{amount} erstattet",
      "details": "Details und Erstattungen",
      "empty": "Noch keine Bestellungen."
    },
    "refund": {
      "heading": "Erstattung",
      "subheading": "Das Geld geht über Stripe auf die Karte zurück, mit der bezahlt wurde. Das lässt sich nicht rückgängig machen.",
      "backToOrders": "Zurück zu den Bestellungen",
      "remaining": "Erstattbar: {amount}",
      "nothingLeft": "Diese Bestellung wurde vollständig erstattet.",
      "notRefundable": "Nur bezahlte oder versandte Bestellungen können erstattet werden.",
      "noPayment": "Zu dieser Bestellung gibt es keine Stripe-Zahlung.",
      "kind": "Was erstatten?",
      "kindFull": "Den Rest der Bestellung ({amount})",
      "kindItems": "Ausgewählte Artikel",
      "kindPercent": "Einen Prozentsatz der Bestellsumme",
      "kindAmount": "Einen bestimmten Betrag",
      "itemQuantity": "Zu erstattende Stück",
      "itemRefunded": "{count} bereits erstattet",
      "percentLabel": "Prozent von {total}",
      "amountLabel": "Betrag in {currency}",
      "reason": "Nachricht an den Kunden (optional)",
      "reasonHint": "Wird in die Erstattungs-E-Mail aufgenommen.",
      "preview": "Erstattungsbetrag: {amount}",
      "confirmLabel": "Zur Bestätigung {word} eingeben",
      "submit": "{amount} erstatten",
      "submitting": "Wird erstattet...",
      "success": "{amount} erstattet. Stripe-Erstattung {id}.",
      "emailSent": "Der Kunde wurde per E-Mail informiert.",
      "emailOff": "E-Mail ist nicht eingerichtet, der Kunde wurde nicht benachrichtigt.",
      "emailFailed": "Der Kunde konnte nicht benachrichtigt werden: {error}",
      "errors": {
        "not_authorized": "Dazu sind Sie nicht berechtigt.",
        "not_confirmed": "Geben Sie {word} ein, um die Erstattung zu bestätigen.",
        "not_found": "Bestellung nicht gefunden.",
        "no_payment": "Zu dieser Bestellung gibt es keine Stripe-Zahlung.",
        "not_refundable": "Nur bezahlte oder versandte Bestellungen können erstattet werden.",
        "nothing_left": "Diese Bestellung wurde vollständig erstattet.",
        "no_items": "Wählen Sie mindestens einen Artikel.",
        "unknown_item": "Einer der Artikel gehört nicht zu dieser Bestellung.",
        "item_quantity": "Es können nicht mehr Stück erstattet werden als bestellt.",
        "bad_percent": "Geben Sie einen Prozentsatz zwischen 0 und 100 ein.",
        "bad_amount": "Geben Sie einen Betrag größer als null ein.",
        "exceeds_remaining": "Das ist mehr, als noch erstattet werden kann.",
        "stripe": "Stripe hat die Erstattung abgelehnt: {message}",
        "failed": "Die Erstattung konnte nicht gespeichert werden: {message}"
      },
      "history": "Erstattungsverlauf",
      "historyEmpty": "Noch keine Erstattungen.",
      "kinds": {
        "full": "Rest der Bestellung",
        "items": "Artikel",
        "percent": "{percent} % der Summe",
        "amount": "Betrag"
      },
      "statuses": {
        "pending": "Ausstehend",
        "succeeded": "Erstattet",
        "failed": "Fehlgeschlagen"
      },
      "customerEmailed": "Kunde benachrichtigt",
      "customerNotEmailed": "Kunde nicht benachrichtigt"
    },
    "discounts": {
      "heading": "Gutscheincodes",
      "subheading": "Prozent- und Betragscodes werden auch in Stripe angelegt und dort beim Bezahlen angewendet. Codes für kostenlosen Versand wendet der Shop selbst an. Ein Code wird bei der Eingabe und erneut beim Bezahlen geprüft.",
      "newHeading": "Neuer Code",
      "code": "Code",
      "codeHint": "3 bis 32 Buchstaben, Ziffern, Binde- oder Unterstriche. Kunden geben ihn genau so ein; Groß- und Kleinschreibung ist egal.",
      "kind": "Art",
      "kinds": {
        "percent": "Prozent Rabatt",
        "amount": "Betrag Rabatt",
        "free_shipping": "Kostenloser Versand"
      },
      "percent": "Prozent",
      "amount": "Betrag",
      "currency": "Währung (drei Buchstaben, z. B. EUR)",
      "minSubtotal": "Mindestbestellwert (optional)",
      "startsAt": "Gültig ab (optional)",
      "endsAt": "Gültig bis (optional)",
      "maxRedemptions": "Maximale Einlösungen (optional)",
      "create": "Code anlegen",
      "creating": "Wird angelegt...",
      "created": "Code {code} angelegt.",
      "empty": "Noch keine Codes.",
      "columns": {
        "code": "Code",
        "value": "Wert",
        "restrictions": "Einschränkungen",
        "uses": "Einlösungen",
        "status": "Status",
        "actions": "Aktionen"
      },
      "status": {
        "active": "Aktiv",
        "scheduled": "Geplant",
        "expired": "Abgelaufen",
        "exhausted": "Aufgebraucht",
        "retired": "Zurückgezogen"
      },
      "retire": "Zurückziehen",
      "reactivate": "Reaktivieren",
      "delete": "Löschen",
      "deleteConfirm": "Diesen Code löschen? Nur nie eingelöste Codes können gelöscht werden.",
      "retired": "Code {code} zurückgezogen. Kunden können ihn nicht mehr verwenden.",
      "reactivated": "Code {code} ist wieder aktiv.",
      "deleted": "Code {code} gelöscht.",
      "usesOf": "{count} von {max}",
      "minLabel": "mind. {amount}",
      "from": "ab {date}",
      "until": "bis {date}",
      "noRestrictions": "Keine",
      "errors": {
        "code_format": "Codes bestehen aus 3 bis 32 Buchstaben, Ziffern, Binde- oder Unterstrichen.",
        "kind": "Wählen Sie eine Art.",
        "percent": "Geben Sie einen Prozentsatz über 0 und bis 100 ein.",
        "amount": "Geben Sie einen Betrag über null ein, z. B. 5 oder 7,50.",
        "currency": "Geben Sie einen dreistelligen Währungscode ein, z. B. EUR. Betragscodes und Mindestwerte brauchen einen.",
        "min_subtotal": "Geben Sie den Mindestwert als Betrag ein, z. B. 20 oder 20,00.",
        "dates": "Prüfen Sie die Daten: das Ende muss nach dem Beginn liegen.",
        "max_redemptions": "Geben Sie eine ganze Zahl über null ein.",
        "duplicate": "Diesen Code gibt es bereits.",
        "stripe": "Stripe hat den Code abgelehnt: {message}",
        "failed": "Der Code konnte nicht gespeichert werden: {message}",
        "in_use": "Dieser Code wurde bereits eingelöst und kann nicht gelöscht werden. Ziehen Sie ihn stattdessen zurück.",
        "not_found": "Code nicht gefunden.",
        "not_authorized": "Dazu sind Sie nicht berechtigt."
      }
    },
    "seo": {
      "heading": "Suche und Merchant Center",
      "subheading": "Was Google von diesem Shop braucht und wo es einzutragen ist. Jede öffentliche Seite trägt bereits Canonical, hreflang und strukturierte Daten; diese Seite ist die operative Seite davon.",
      "siteUrl": "Öffentliche Site-URL",
      "siteUrlHint": "NEXT_PUBLIC_SITE_URL in der Umgebung setzen. Jeder Canonical-Link, hreflang-Link, Sitemap-Eintrag und jede Feed-URL wird daraus gebildet; es muss der exakte Produktions-Origin sein.",
      "verification": "Google-Website-Bestätigung",
      "verified": "Meta-Tag wird ausgegeben (NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ist gesetzt).",
      "notVerified": "Nicht gesetzt. Den HTML-Tag-Bestätigungscode aus der Search Console als NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION hinterlegen.",
      "sitemap": "Sitemap",
      "sitemapHint": "In der Search Console einreichen. Sie enthält jede Sprachversion jeder indexierbaren Seite mit hreflang-Alternativen.",
      "feeds": "Merchant-Center-Produktfeeds",
      "feedsHint": "Ein Feed pro Locale. Im Merchant Center eine Produktquelle aus einer per URL gehosteten Datei anlegen, eine pro Zielland und Sprache, und hierher zeigen lassen. Google ruft sie alle 24 Stunden ab. Automatische Artikelaktualisierungen einschalten, damit die strukturierten Daten der Seite einen veralteten Preis korrigieren, statt dass der Artikel abgelehnt wird.",
      "feedFor": "Feed für {locale}",
      "locales": "Locales",
      "localesHint": "Jede ist ein URL-Präfix mit eigenem Canonical und hreflang-Set. Eine Sprache-Land-Locale (de-at) erbt die Texte ihrer Sprache und überschreibt nur, was abweicht.",
      "checklist": "Checkliste",
      "steps": {
        "verify": "Die Site in der Search Console bestätigen und mit demselben Google-Konto im Merchant Center beanspruchen.",
        "sitemap": "Die Sitemap in der Search Console einreichen.",
        "feeds": "Im Merchant Center pro Zielland eine Produktquelle mit den obigen Feed-URLs anlegen, oder das Merchant Center die strukturierten Daten der Produktseiten direkt lesen lassen.",
        "identifiers": "Marke, SKU und Barcode (GTIN) bei den Produkten pflegen: Google lehnt Produkte mit ungültigen Kennungen ab und stuft solche ohne Kennung schlechter ein.",
        "shipping": "Versand- und Rückgaberichtlinien im Merchant Center konfigurieren; es bevorzugt diese gegenüber strukturierten Daten.",
        "currency": "Preise und Währung auf den Seiten müssen dem Feed des jeweiligen Ziellands entsprechen. Die Währung nie nach Besucherstandort umschalten."
      }
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
    },
    "email": {
      "heading": "E-Mail-Kampagnen",
      "subheading": "Vorlagen für Newsletter und Angebote. Sehen Sie sie in jeder Sprache des Shops an und senden Sie sich einen Test, bevor etwas an Kunden geht.",
      "comingSoon": "Der Versand an Abonnenten ist in Arbeit; bis dahin können Sie sich aus jeder Vorlage einen Test senden.",
      "notConfigured": "Testversand braucht RESEND_API_KEY und EMAIL_FROM in der Umgebung des Shops. Die Vorschau funktioniert auch ohne.",
      "newHeading": "Neue Vorlage",
      "name": "Name",
      "starter": "Beginnen mit",
      "starters": {
        "blank": "Leer",
        "newsletter": "Newsletter"
      },
      "create": "Vorlage anlegen",
      "creating": "Wird angelegt…",
      "empty": "Noch keine Vorlagen. Legen Sie oben eine an.",
      "columns": {
        "name": "Name",
        "updated": "Zuletzt bearbeitet",
        "lastTest": "Letzter Test",
        "actions": "Aktionen"
      },
      "never": "Nie",
      "duplicate": "Duplizieren",
      "delete": "Löschen",
      "confirmDelete": "Die Vorlage „{name}“ löschen? Das lässt sich nicht rückgängig machen.",
      "copySuffix": "(Kopie)",
      "notices": {
        "created": "Vorlage „{name}“ angelegt.",
        "duplicated": "Kopiert als „{name}“.",
        "deleted": "Vorlage „{name}“ gelöscht."
      },
      "errors": {
        "name": "Geben Sie der Vorlage einen Namen mit höchstens 120 Zeichen.",
        "document": "Die Vorlage hat {count, plural, one {# Problem} other {# Probleme}} und wurde nicht gespeichert.",
        "tooLarge": "Die Vorlage ist zu groß zum Speichern.",
        "starter": "Wählen Sie ein Layout zum Beginnen.",
        "notFound": "Diese Vorlage gibt es nicht mehr.",
        "notAuthorized": "Das darf nur der Shop-Inhaber.",
        "failed": "Etwas ist schiefgegangen: {message}"
      },
      "back": "Alle Vorlagen",
      "save": "Speichern",
      "saving": "Wird gespeichert…",
      "language": "Sprache",
      "subject": "Betreff",
      "preheader": "Vorschautext",
      "noPreheader": "Keiner",
      "preview": {
        "heading": "Vorschau",
        "desktop": "Desktop",
        "phone": "Smartphone",
        "frameTitle": "E-Mail-Vorschau, {width} Pixel breit",
        "sampleNote": "Platzhalter zeigen einen Beispiel-Abonnenten namens {name}. Solange es keine Abonnentenliste gibt, führt der Abmeldelink zur Startseite des Shops."
      },
      "renderFailed": {
        "invalidDocument": "Diese Vorlage kann nicht gelesen werden: {issues}",
        "empty": "Diese Vorlage zeigt in dieser Sprache noch nichts."
      },
      "warningsHeading": "Bitte prüfen",
      "noWarnings": "In dieser Sprache ist nichts zu korrigieren.",
      "warningIn": "{message} (Block {block})",
      "warnings": {
        "invalidBlock": "Ein Block konnte nicht gelesen werden und fehlt.",
        "blockFailed": "Ein Block konnte nicht dargestellt werden und fehlt.",
        "missingTranslation": "Noch nicht in diese Sprache übersetzt, daher wird der Text in {language} gezeigt.",
        "emptyBlock": "Hat in dieser Sprache keinen Text und fehlt deshalb.",
        "missingProduct": "Das Produkt ist nicht mehr im Shop, daher fehlt dieser Block.",
        "missingDiscount": "Der Code {detail} ist deaktiviert, abgelaufen oder aufgebraucht, daher fehlt dieser Block.",
        "unknownMergeTag": "Unbekannter Platzhalter „{detail}“; sein Ersatztext wird verwendet.",
        "unsafeUrl": "Ein Link, der nicht mit http(s) oder mailto beginnt, wurde entfernt: {detail}",
        "missingUnsubscribe": "Es gibt keinen Abmeldelink."
      },
      "test": {
        "heading": "Test senden",
        "intro": "Sendet diese Vorlage an eine Adresse, mit [Test] im Betreff. Platzhalter zeigen den Beispiel-Abonnenten.",
        "to": "Senden an",
        "language": "Sprache",
        "send": "Test senden",
        "sending": "Wird gesendet…",
        "subjectPrefix": "[Test]",
        "result": {
          "sent": "An {to} gesendet. Resend-Nachrichten-ID: {id}.",
          "notConfigured": "Nicht gesendet: E-Mail ist nicht eingerichtet (RESEND_API_KEY und EMAIL_FROM).",
          "providerError": "Resend hat die E-Mail nicht angenommen: {error}",
          "invalidTemplate": "Nicht gesendet: Die Vorlage kann nicht gelesen werden.",
          "empty": "Nicht gesendet: In dieser Sprache bleibt nichts zu zeigen.",
          "invalidRecipient": "Das sieht nicht nach einer E-Mail-Adresse aus.",
          "invalidLocale": "Diese Sprache gehört nicht zum Shop.",
          "tooSoon": "Ein Test dieser Vorlage wurde gerade erst gesendet. Warten Sie ein paar Sekunden und versuchen Sie es erneut.",
          "notFound": "Diese Vorlage gibt es nicht mehr.",
          "notAuthorized": "Nur der Shop-Inhaber kann Tests senden.",
          "failed": "Etwas ist schiefgegangen: {error}"
        },
        "details": "{duration} ms, {count, plural, =0 {keine Hinweise} one {# Hinweis} other {# Hinweise}}",
        "logged": "Protokolliert in {file}",
        "notLogged": "Nicht protokolliert: {error}"
      },
      "designer": {
        "undo": "Rückgängig",
        "redo": "Wiederholen",
        "saveBlocked": "Vor dem Speichern {count, plural, one {ist # Problem} other {sind # Probleme}} zu beheben.",
        "unsaved": "Ungespeicherte Änderungen",
        "saved": "Alle Änderungen gespeichert",
        "reset": "Diese Vorlage konnte nicht gelesen werden, daher beginnen Sie mit einer leeren E-Mail. Speichern ersetzt sie.",
        "dropped": "{count, plural, one {# Block konnte} other {# Blöcke konnten}} nicht gelesen werden und {count, plural, one {fehlt} other {fehlen}}. Speichern behält den Rest.",
        "settingsHeading": "E-Mail-Einstellungen",
        "problems": "{count, plural, one {# Problem} other {# Probleme}}",
        "addBlock": "Block hinzufügen",
        "previewWaiting": "Die Vorschau erscheint, sobald die E-Mail einen Betreff in der Hauptsprache hat.",
        "testUsesSaved": "Tests senden die zuletzt gespeicherte Fassung. Speichern Sie zuerst, um Ihre Änderungen zu testen.",
        "editingLanguage": "Sprache",
        "defaultLanguage": "{locale} (Haupt)",
        "missingCount": "{count, plural, one {# Feld} other {# Felder}} nicht übersetzt",
        "untranslatedBadge": "Nicht übersetzt",
        "notTranslated": "Noch nicht übersetzt: Leser in dieser Sprache sehen den Text in {language}.",
        "copyFrom": "Mit dem Text in {language} beginnen",
        "addToColumn": "Zu Spalte {number} hinzufügen",
        "dropHere": "Hier ablegen",
        "empty": "Diese E-Mail ist leer. Fügen Sie einen Block hinzu, um zu beginnen.",
        "linkInvalid": "Die Adresse muss mit https://, http:// oder mailto: beginnen",
        "blocks": {
          "heading": "Überschrift",
          "text": "Text",
          "image": "Bild",
          "button": "Schaltfläche",
          "product": "Produkt",
          "discount": "Rabattcode",
          "divider": "Trennlinie",
          "spacer": "Abstand",
          "columns": "Spalten"
        },
        "blockHints": {
          "heading": "Ein Titel in großer Schrift",
          "text": "Absätze mit Fettdruck, Links, Listen und Farben",
          "image": "Ein Bild, auf Wunsch verlinkt",
          "button": "Ein Link zum Antippen",
          "product": "Ein Produkt mit Bild, Preis und Schaltfläche",
          "discount": "Ein Code für die Kasse",
          "divider": "Eine dünne Linie",
          "spacer": "Leerer Raum",
          "columns": "Zwei oder drei Blöcke nebeneinander"
        },
        "newBlock": {
          "heading": "Eine neue Überschrift",
          "text": "Schreiben Sie hier etwas.",
          "button": "Jetzt einkaufen"
        },
        "actions": {
          "drag": "Zum Verschieben ziehen",
          "moveUp": "Nach oben",
          "moveDown": "Nach unten",
          "duplicate": "Duplizieren",
          "remove": "Entfernen"
        },
        "links": {
          "home": "Startseite des Shops",
          "shop": "Alle Produkte"
        },
        "mergeTags": {
          "button": "Persönliche Angaben",
          "fallbackName": "zusammen",
          "subscriber_first_name": "Vorname",
          "subscriber_email": "Ihre E-Mail-Adresse",
          "shop_name": "Name des Shops",
          "shop_url": "Adresse des Shops",
          "shop_locale_url": "Adresse des Shops in ihrer Sprache",
          "unsubscribe_url": "Abmeldelink",
          "current_year": "Aktuelles Jahr"
        },
        "toolbar": {
          "style": "Textstil",
          "paragraph": "Normaler Text",
          "heading1": "Große Überschrift",
          "heading2": "Mittlere Überschrift",
          "heading3": "Kleine Überschrift",
          "bold": "Fett",
          "italic": "Kursiv",
          "underline": "Unterstrichen",
          "strike": "Durchgestrichen",
          "fontSize": "Schriftgröße",
          "defaultSize": "Größe",
          "color": "Textfarbe",
          "defaultColor": "Farbe",
          "brandColor": "Markenfarbe",
          "bulletList": "Aufzählung",
          "orderedList": "Nummerierte Liste",
          "alignLeft": "Linksbündig",
          "alignCenter": "Zentriert",
          "alignRight": "Rechtsbündig",
          "link": "Link",
          "unlink": "Link entfernen",
          "linkPlaceholder": "https://…",
          "linkShop": "Alle Produkte",
          "apply": "Übernehmen",
          "cancel": "Abbrechen",
          "linkInvalid": "Die Adresse muss mit https://, http:// oder mailto: beginnen"
        },
        "fields": {
          "subject": "Betreff",
          "subjectHint": "Das sehen Empfänger in ihrem Posteingang.",
          "preheader": "Vorschautext",
          "preheaderHint": "Wird in den meisten Postfächern nach dem Betreff gezeigt.",
          "footer": "Fußzeile",
          "footerHint": "Firmenname und Postanschrift. Viele Länder schreiben sie in Werbe-E-Mails vor.",
          "headingText": "Überschrift",
          "level": "Größe",
          "levels": {
            "1": "Groß",
            "2": "Mittel",
            "3": "Klein"
          },
          "align": "Ausrichtung",
          "aligns": {
            "start": "Anfang",
            "center": "Mitte",
            "end": "Ende"
          },
          "imageUrl": "Bild",
          "chooseImage": "Laden Sie ein Bild hoch oder fügen Sie seine https://-Adresse ein.",
          "upload": "Bild hochladen",
          "uploading": "Wird hochgeladen…",
          "uploadFailed": "Das Hochladen ist fehlgeschlagen: {message}",
          "alt": "Beschreibung",
          "altHint": "Wird Menschen vorgelesen, die keine Bilder sehen, und erscheint, wenn Bilder blockiert sind.",
          "link": "Link",
          "linkOptional": "Link (optional)",
          "width": "Breite",
          "label": "Beschriftung",
          "color": "Farbe",
          "useBrandColor": "Markenfarbe verwenden",
          "defaultColor": "Standardfarbe",
          "fullWidth": "Volle Breite",
          "product": "Produkt",
          "chooseProduct": "Wählen Sie ein Produkt aus der Liste oder suchen Sie danach.",
          "productMissing": "Dieses Produkt ist nicht mehr im Shop. Wählen Sie ein anderes.",
          "searchProducts": "Produkte suchen",
          "noProducts": "Keine Produkte gefunden.",
          "showPrice": "Preis zeigen",
          "buttonLabel": "Beschriftung der Schaltfläche",
          "leaveEmptyFor": "Leer lassen für „{text}“.",
          "discount": "Code",
          "chooseDiscount": "Code wählen",
          "noDiscounts": "Es gibt keine aktiven Rabattcodes. Legen Sie zuerst unter Rabattcodes einen an.",
          "discountScheduled": "{code} (beginnt später)",
          "discountMissing": "Der Code {code} ist deaktiviert, abgelaufen oder aufgebraucht. Wählen Sie einen anderen.",
          "title": "Titel",
          "note": "Hinweis",
          "height": "Höhe",
          "layout": "Aufteilung",
          "layouts": {
            "1-1": "Zwei gleich breit",
            "1-2": "Schmal und breit",
            "2-1": "Breit und schmal",
            "1-1-1": "Drei gleich breit"
          },
          "stackOnMobile": "Auf Smartphones untereinander",
          "column": "Spalte {number}",
          "emptyColumn": "Noch leer."
        },
        "theme": {
          "heading": "Aussehen",
          "brandColor": "Markenfarbe",
          "textColor": "Text",
          "backgroundColor": "Hintergrund",
          "contentColor": "E-Mail-Fläche",
          "font": "Schrift",
          "fonts": {
            "system": "Modern",
            "sans": "Klassisch serifenlos",
            "serif": "Mit Serifen"
          },
          "logo": "Logo",
          "logoWidth": "Logobreite",
          "removeLogo": "Logo entfernen"
        }
      }
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
        "heatChip": "Schärfe: {value}",
        "categoryChip": "Kategorie: {value}",
        "allChilliTypes": "Alle Chilisorten",
        "sortMildToHot": "Mild bis scharf",
        "sortHotToMild": "Scharf bis mild"
      }
    },
    "results": {
      "noResults": "Keine Treffer",
      "adjustSearch": "Versuchen Sie eine andere Suche oder einen anderen Filter.",
      "showingCount": "{shown} von {total} Produkten angezeigt",
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
    "country": "Land",
    "selectCountry": "Land auswählen",
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
    "discount": "Rabatt ({code})",
    "freeShipping": "Kostenloser Versand ({code})",
    "discountInvalid": "Ihr Gutscheincode gilt nicht mehr und wurde entfernt. Bitte prüfen Sie die Summe, bevor Sie bezahlen.",
    "total": "Gesamt",
    "shipTo": "Lieferung an",
    "createAccountTitle": "Bestellung im Blick behalten",
    "createAccountBody": "Erstellen Sie ein Konto mit {email}. Sobald Sie Ihre E-Mail-Adresse bestätigt haben, wird diese Bestellung darin gespeichert.",
    "createAccount": "Konto erstellen",
    "savedToAccount": "Diese Bestellung ist in Ihrem Konto gespeichert.",
    "addressAtStripe": "Ihre Lieferadresse geben Sie auf der sicheren Zahlungsseite ein."
  },
  "Email": {
    "shipping": {
      "subject": "{shop}: Bestellung {reference} ist unterwegs",
      "headline": "Ihre Bestellung ist unterwegs",
      "intro": "Gute Nachrichten: Bestellung {reference} wurde dem Versanddienst übergeben.",
      "tracking": "Sendungsverfolgung",
      "carrier": "Versanddienst",
      "trackingNumber": "Sendungsnummer",
      "track": "Sendung verfolgen",
      "items": "Im Paket",
      "address": "Lieferung an",
      "viewOrders": "Ihre Bestellungen ansehen",
      "footer": "Fragen? Antworten Sie einfach auf diese E-Mail."
    },
    "confirmation": {
      "subject": "{shop}: Bestellung {reference} bestätigt",
      "headline": "Vielen Dank für Ihre Bestellung",
      "order": "Bestellung {reference}",
      "subtotal": "Zwischensumme",
      "shipping": "Versand",
      "discount": "Rabatt",
      "total": "Gesamt",
      "address": "Lieferadresse",
      "viewOrder": "Bestellung ansehen",
      "footer": "Wir melden uns wieder per E-Mail, sobald Ihre Bestellung unterwegs ist."
    },
    "refund": {
      "subject": "{shop}: Erstattung von {amount} für Bestellung {reference}",
      "headlineFull": "Ihre Bestellung wurde erstattet",
      "headlinePartial": "Eine Erstattung ist unterwegs",
      "summaryFull": "Wir haben die vollen {total} für Bestellung {reference} erstattet.",
      "summaryPartial": "Wir haben {amount} der Bestellung {reference} erstattet.",
      "refundedSoFar": "Bisher erstattet: {refunded} von {total}.",
      "viewOrders": "Ihre Bestellungen ansehen",
      "footer": "Das Geld geht auf die Karte oder das Konto zurück, mit dem Sie bezahlt haben. Banken zeigen es meist innerhalb von 5 bis 10 Werktagen an."
    },
    "campaign": {
      "footerReason": "Sie erhalten diese E-Mail, weil Sie Neuigkeiten von {shop} abonniert haben.",
      "unsubscribe": "Abmelden",
      "viewProduct": "Zum Produkt",
      "discountTitle": "Ihr Code",
      "discountHint": "Geben Sie ihn im Warenkorb oder an der Kasse ein.",
      "discountPercent": "{percent} % Rabatt",
      "discountAmount": "{amount} Rabatt",
      "discountFreeShipping": "Kostenloser Versand"
    }
  },
  "Home": {
    "__after__": "Nav",
    "tagline": "Willkommen bei {shop}",
    "browse": "Zum Shop"
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
    "Account": "Hesap",
    "Home": "Ana sayfa"
  },
  "Account": {
    "ordersTitle": "Siparişleriniz",
    "noOrders": "Henüz sipariş vermediniz.",
    "startShopping": "Alışverişe başla",
    "orderNumber": "Sipariş {number}",
    "total": "Toplam",
    "discount": "İndirim ({code})",
    "shippedOn": "{date} tarihinde kargolandı",
    "trackingNumber": "Takip numarası {number}",
    "track": "Kargonuzu takip edin",
    "refundedAmount": "{amount} iade edildi",
    "status": {
      "pending": "Beklemede",
      "paid": "Ödendi",
      "fulfilled": "Kargolandı",
      "cancelled": "İptal edildi",
      "refunded": "İade edildi"
    }
  },
  "Shop": {
    "title": "Mağaza",
    "empty": "Henüz ürün yok."
  },
  "Product": {
    "backToShop": "Mağazaya dön",
    "noImage": "Henüz görsel yok",
    "imageAlt": "{name}, görsel {index} / {count}",
    "galleryLabel": "Ürün görselleri",
    "showImage": "Görsel {index} / {count}",
    "wasPrice": "Önceki fiyat {price}",
    "inStock": "Stokta var",
    "lowStock": "Yalnızca {count} adet kaldı",
    "backorder": "Sipariş verilebilir, stoğa girince gönderilir",
    "soldOut": "Tükendi",
    "brand": "Marka",
    "category": "Kategori",
    "tags": "Etiketler",
    "about": "Bu ürün hakkında",
    "facts": "Ürün bilgileri",
    "netContent": "Net miktar",
    "weight": "Ağırlık",
    "dimensions": "Boyutlar",
    "countryOfOrigin": "Menşe ülke",
    "ingredients": "İçindekiler",
    "allergens": "Alerjenler",
    "dietary": "Beslenme",
    "storage": "Saklama koşulları",
    "bestBefore": "Tavsiye edilen tüketim tarihi",
    "nutritionTitle": "100 g / ml için besin değerleri",
    "nutrition": {
      "energy_kj": "Enerji (kJ)",
      "energy_kcal": "Enerji (kcal)",
      "fat_g": "Yağ (g)",
      "saturated_fat_g": "Doymuş yağ (g)",
      "carbohydrate_g": "Karbonhidrat (g)",
      "sugar_g": "Şeker (g)",
      "protein_g": "Protein (g)",
      "salt_g": "Tuz (g)"
    },
    "dietaryFlags": {
      "vegan": "Vegan",
      "vegetarian": "Vejetaryen",
      "gluten-free": "Glutensiz",
      "dairy-free": "Süt ürünü içermez",
      "nut-free": "Kuruyemiş içermez",
      "organic": "Organik"
    },
    "units": {
      "pieces": "adet"
    },
    "heat": "Acılık",
    "heatMeter": "Acılık {level} / {max}",
    "scoville": "{shu} SHU",
    "chilliTypes": "Biber türleri"
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
    "quantity": "Adet",
    "increase": "Adedi artır",
    "decrease": "Adedi azalt",
    "remove": "Kaldır",
    "clear": "Sepeti boşalt",
    "subtotal": "Ara toplam",
    "shippingAtCheckout": "Kargo ücreti ödeme adımında hesaplanır.",
    "checkout": "Ödemeye geç",
    "continueShopping": "Alışverişe devam et",
    "discount": {
      "label": "Promosyon kodu",
      "placeholder": "Kodu girin",
      "apply": "Uygula",
      "applying": "Kontrol ediliyor...",
      "remove": "Kaldır",
      "applied": "{code} kodu uygulandı",
      "line": "İndirim ({code})",
      "shipping": "Kargo",
      "freeShipping": "{code} ile ücretsiz",
      "total": "Toplam",
      "errors": {
        "invalid_format": "Bu bir koda benzemiyor. Kodlar 3 ila 32 harf, rakam, tire veya alt çizgiden oluşur.",
        "not_found": "Bu kodu tanımıyoruz. Yazımı kontrol edip tekrar deneyin.",
        "inactive": "Bu kod artık geçerli değil.",
        "not_started": "Bu kod henüz geçerli değil.",
        "expired": "Bu kodun süresi dolmuş.",
        "exhausted": "Bu kod kullanılabileceği kadar kullanılmış.",
        "min_subtotal": "Bu kod için en az {minimum} tutarında sipariş gerekiyor.",
        "currency_mismatch": "Bu kod farklı bir para birimi için.",
        "nothing_to_discount": "Bu siparişte kargo zaten ücretsiz, bu kod bir şey değiştirmez.",
        "failed": "Kod şu anda uygulanamadı. Lütfen tekrar deneyin."
      }
    }
  },
  "Admin": {
    "title": "Store admin",
    "dashboardHeading": "Manage your catalogue",
    "dashboardWelcomeHeading": "You're in control",
    "dashboardWelcomeCopy": "Use the admin panel to add new sauces, edit listings, and keep imagery fresh.",
    "nav": {
      "dashboard": "Dashboard",
      "products": "Products",
      "newProduct": "New product",
      "orders": "Siparişler",
      "discounts": "İndirim kodları",
      "seo": "Arama ve Merchant Center",
      "email": "E-posta"
    },
    "stats": {
      "products": "Products",
      "brands": "Brands",
      "categories": "Categories"
    },
    "orders": {
      "heading": "Siparişler",
      "subheading": "Tüm ödenmiş siparişler, en yeni önce. Stripe üzerinden iade etmek için siparişi açın.",
      "order": "Sipariş {number}",
      "status": "Durum",
      "save": "Kaydet",
      "tracking": "Kargo takibi (isteğe bağlı, durum Kargolandı olduğunda kaydedilir)",
      "carrier": "Kargo firması",
      "trackingNumber": "Takip numarası",
      "trackingUrl": "Takip bağlantısı",
      "trackingUrlHint": "Bilinen firmalar için boş bırakın; firmanın sayfası kullanılır.",
      "autoEmailHint": "Durumu Kargolandı yapmak müşteriye bir kez e-posta gönderir. İleri geri değiştirmek yeniden e-posta göndermez.",
      "shippedOn": "Kargolandı {date}",
      "customerNotified": "Müşteriye e-posta gönderildi {date}",
      "customerNotNotified": "Müşteriye kargo e-postası gönderilmedi",
      "sendShippingEmail": "Kargo e-postası gönder",
      "resendShippingEmail": "Kargo e-postasını yeniden gönder",
      "shippingEmailSent": "Kargo e-postası {email} adresine gönderildi.",
      "shippingEmailOff": "E-posta yapılandırılmadığı için kargo e-postası gönderilmedi.",
      "shippingEmailFailed": "Kargo e-postası gönderilemedi: {error}",
      "statusSaved": "Durum kaydedildi.",
      "statusFailed": "Durum kaydedilemedi: {error}",
      "total": "Toplam",
      "discount": "İndirim ({code})",
      "refundedSoFar": "{amount} iade edildi",
      "details": "Ayrıntılar ve iadeler",
      "empty": "Henüz sipariş yok."
    },
    "refund": {
      "heading": "İade",
      "subheading": "Para, Stripe üzerinden müşterinin ödeme yaptığı karta geri gönderilir. Bu işlem geri alınamaz.",
      "backToOrders": "Siparişlere dön",
      "remaining": "İade edilebilir tutar: {amount}",
      "nothingLeft": "Bu siparişin tamamı iade edildi.",
      "notRefundable": "Yalnızca ödenmiş veya kargolanmış siparişler iade edilebilir.",
      "noPayment": "Bu siparişin iade edilecek bir Stripe ödemesi yok.",
      "kind": "Ne iade edilecek?",
      "kindFull": "Siparişin kalanı ({amount})",
      "kindItems": "Seçili ürünler",
      "kindPercent": "Sipariş toplamının bir yüzdesi",
      "kindAmount": "Belirli bir tutar",
      "itemQuantity": "İade edilecek adet",
      "itemRefunded": "{count} adedi zaten iade edildi",
      "percentLabel": "{total} tutarının yüzdesi",
      "amountLabel": "Tutar ({currency})",
      "reason": "Müşteriye not (isteğe bağlı)",
      "reasonHint": "İade e-postasına eklenir.",
      "preview": "İade tutarı: {amount}",
      "confirmLabel": "Onaylamak için {word} yazın",
      "submit": "{amount} iade et",
      "submitting": "İade ediliyor...",
      "success": "{amount} iade edildi. Stripe iadesi {id}.",
      "emailSent": "Müşteriye e-posta gönderildi.",
      "emailOff": "E-posta yapılandırılmadığı için müşteri bilgilendirilmedi.",
      "emailFailed": "Müşteriye e-posta gönderilemedi: {error}",
      "errors": {
        "not_authorized": "Bunu yapma yetkiniz yok.",
        "not_confirmed": "İadeyi onaylamak için {word} yazın.",
        "not_found": "Sipariş bulunamadı.",
        "no_payment": "Bu siparişin iade edilecek bir Stripe ödemesi yok.",
        "not_refundable": "Yalnızca ödenmiş veya kargolanmış siparişler iade edilebilir.",
        "nothing_left": "Bu siparişin tamamı iade edildi.",
        "no_items": "En az bir ürün seçin.",
        "unknown_item": "Ürünlerden biri bu siparişe ait değil.",
        "item_quantity": "Sipariş edilenden fazla adet iade edemezsiniz.",
        "bad_percent": "0 ile 100 arasında bir yüzde girin.",
        "bad_amount": "Sıfırdan büyük bir tutar girin.",
        "exceeds_remaining": "Bu, kalan iade edilebilir tutardan fazla.",
        "stripe": "Stripe iadeyi reddetti: {message}",
        "failed": "İade kaydedilemedi: {message}"
      },
      "history": "İade geçmişi",
      "historyEmpty": "Henüz iade yok.",
      "kinds": {
        "full": "Siparişin kalanı",
        "items": "Ürünler",
        "percent": "Toplamın %{percent}'i",
        "amount": "Tutar"
      },
      "statuses": {
        "pending": "Bekliyor",
        "succeeded": "İade edildi",
        "failed": "Başarısız"
      },
      "customerEmailed": "Müşteriye e-posta gönderildi",
      "customerNotEmailed": "Müşteriye e-posta gönderilmedi"
    },
    "discounts": {
      "heading": "İndirim kodları",
      "subheading": "Yüzde ve tutar kodları Stripe'ta da oluşturulur ve ödeme sırasında Stripe tarafından uygulanır. Ücretsiz kargo kodlarını mağaza uygular. Kod, müşteri girdiğinde ve ödeme yaparken tekrar kontrol edilir.",
      "newHeading": "Yeni kod",
      "code": "Kod",
      "codeHint": "3 ila 32 harf, rakam, tire veya alt çizgi. Müşteriler aynen yazar; büyük-küçük harf fark etmez.",
      "kind": "Tür",
      "kinds": {
        "percent": "Yüzde indirim",
        "amount": "Tutar indirimi",
        "free_shipping": "Ücretsiz kargo"
      },
      "percent": "Yüzde",
      "amount": "Tutar",
      "currency": "Para birimi (üç harf, ör. EUR)",
      "minSubtotal": "Minimum sipariş (isteğe bağlı)",
      "startsAt": "Başlangıç (isteğe bağlı)",
      "endsAt": "Bitiş (isteğe bağlı)",
      "maxRedemptions": "Maksimum kullanım (isteğe bağlı)",
      "create": "Kod oluştur",
      "creating": "Oluşturuluyor...",
      "created": "{code} kodu oluşturuldu.",
      "empty": "Henüz kod yok.",
      "columns": {
        "code": "Kod",
        "value": "Değer",
        "restrictions": "Kısıtlamalar",
        "uses": "Kullanım",
        "status": "Durum",
        "actions": "İşlemler"
      },
      "status": {
        "active": "Aktif",
        "scheduled": "Planlandı",
        "expired": "Süresi doldu",
        "exhausted": "Tükendi",
        "retired": "Kaldırıldı"
      },
      "retire": "Kaldır",
      "reactivate": "Yeniden etkinleştir",
      "delete": "Sil",
      "deleteConfirm": "Bu kod silinsin mi? Yalnızca hiç kullanılmamış kodlar silinebilir.",
      "retired": "{code} kodu kaldırıldı. Müşteriler artık kullanamaz.",
      "reactivated": "{code} kodu yeniden aktif.",
      "deleted": "{code} kodu silindi.",
      "usesOf": "{count} / {max}",
      "minLabel": "en az {amount}",
      "from": "{date} itibarıyla",
      "until": "{date} tarihine kadar",
      "noRestrictions": "Yok",
      "errors": {
        "code_format": "Kodlar 3 ila 32 harf, rakam, tire veya alt çizgiden oluşur.",
        "kind": "Bir tür seçin.",
        "percent": "0'dan büyük ve en fazla 100 olan bir yüzde girin.",
        "amount": "Sıfırdan büyük bir tutar girin, ör. 5 veya 7,50.",
        "currency": "Üç harfli bir para birimi kodu girin, ör. EUR. Tutar kodları ve minimumlar için gereklidir.",
        "min_subtotal": "Minimumu tutar olarak girin, ör. 20 veya 20,00.",
        "dates": "Tarihleri kontrol edin: bitiş, başlangıçtan sonra olmalı.",
        "max_redemptions": "Sıfırdan büyük bir tam sayı girin.",
        "duplicate": "Bu kod zaten var.",
        "stripe": "Stripe kodu reddetti: {message}",
        "failed": "Kod kaydedilemedi: {message}",
        "in_use": "Bu kod kullanılmış, bu yüzden silinemez. Bunun yerine kaldırın.",
        "not_found": "Kod bulunamadı.",
        "not_authorized": "Bunu yapma yetkiniz yok."
      }
    },
    "seo": {
      "heading": "Arama ve Merchant Center",
      "subheading": "Google'ın bu mağazadan beklediği şeyler ve nereye yapıştırılacağı. Her herkese açık sayfa zaten canonical, hreflang ve yapılandırılmış veri taşıyor; bu sayfa işin operasyonel tarafı.",
      "siteUrl": "Herkese açık site URL'si",
      "siteUrlHint": "Ortamda NEXT_PUBLIC_SITE_URL değerini ayarlayın. Her canonical bağlantı, hreflang bağlantısı, site haritası girdisi ve feed URL'si bundan üretilir; tam üretim origin'i olmalıdır.",
      "verification": "Google site doğrulaması",
      "verified": "Meta etiketi üretiliyor (NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ayarlı).",
      "notVerified": "Ayarlı değil. Search Console'daki HTML etiketi doğrulama kodunu NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION olarak ekleyin.",
      "sitemap": "Site haritası",
      "sitemapHint": "Bunu Search Console'a gönderin. Dizine eklenebilir her sayfanın her dil sürümünü hreflang alternatifleriyle listeler.",
      "feeds": "Merchant Center ürün feed'leri",
      "feedsHint": "Her locale için bir feed. Merchant Center'da URL'de barındırılan bir dosyadan ürün kaynağı ekleyin, hedef ülke ve dil başına bir tane, ve buraya yönlendirin. Google 24 saatte bir çeker. Sayfanın yapılandırılmış verisinin eski fiyatı düzeltmesi için otomatik ürün güncellemelerini açın; böylece ürün reddedilmez.",
      "feedFor": "{locale} için feed",
      "locales": "Locale'ler",
      "localesHint": "Her biri kendi canonical ve hreflang setine sahip bir URL önekidir. Dil-ülke locale'i (de-at) dilinin metnini devralır ve yalnızca farklı olanı geçersiz kılar.",
      "checklist": "Kontrol listesi",
      "steps": {
        "verify": "Siteyi Search Console'da doğrulayın ve aynı Google hesabıyla Merchant Center'da sahiplenin.",
        "sitemap": "Site haritasını Search Console'a gönderin.",
        "feeds": "Yukarıdaki feed URL'leriyle Merchant Center'da hedef ülke başına bir ürün kaynağı ekleyin veya Merchant Center'ın ürün sayfalarının yapılandırılmış verisini doğrudan okumasına izin verin.",
        "identifiers": "Ürünlerde marka, SKU ve barkod (GTIN) bilgilerini doldurun: Google geçersiz tanımlayıcılı ürünleri reddeder, tanımlayıcısızları daha düşük sıralar.",
        "shipping": "Kargo ve iade politikalarını Merchant Center'da yapılandırın; yapılandırılmış veriye tercih eder.",
        "currency": "Sayfalardaki fiyat ve para birimi, her hedef ülke için feed ile eşleşmelidir. Para birimini asla ziyaretçi konumuna göre değiştirmeyin."
      }
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
    },
    "email": {
      "heading": "E-posta kampanyaları",
      "subheading": "Bültenler ve teklifler için şablonlar. Mağazanın her dilinde önizleyin ve müşterilere bir şey gitmeden önce kendinize bir test gönderin.",
      "comingSoon": "Abonelere gönderim yolda; o zamana kadar herhangi bir şablondan kendinize test gönderebilirsiniz.",
      "notConfigured": "Test gönderimi için mağaza ortamında RESEND_API_KEY ve EMAIL_FROM gerekir. Önizleme bunlar olmadan da çalışır.",
      "newHeading": "Yeni şablon",
      "name": "Ad",
      "starter": "Başlangıç",
      "starters": {
        "blank": "Boş",
        "newsletter": "Bülten"
      },
      "create": "Şablon oluştur",
      "creating": "Oluşturuluyor…",
      "empty": "Henüz şablon yok. Yukarıdan bir tane oluşturun.",
      "columns": {
        "name": "Ad",
        "updated": "Son düzenleme",
        "lastTest": "Son test",
        "actions": "İşlemler"
      },
      "never": "Hiç",
      "duplicate": "Kopyala",
      "delete": "Sil",
      "confirmDelete": "“{name}” şablonu silinsin mi? Bu geri alınamaz.",
      "copySuffix": "(kopya)",
      "notices": {
        "created": "“{name}” şablonu oluşturuldu.",
        "duplicated": "“{name}” olarak kopyalandı.",
        "deleted": "“{name}” şablonu silindi."
      },
      "errors": {
        "name": "Şablona en fazla 120 karakterlik bir ad verin.",
        "document": "Şablonda {count, plural, one {# sorun} other {# sorun}} var ve kaydedilmedi.",
        "tooLarge": "Şablon kaydedilemeyecek kadar büyük.",
        "starter": "Başlamak için bir düzen seçin.",
        "notFound": "Bu şablon artık yok.",
        "notAuthorized": "Bunu yalnızca mağaza sahibi yapabilir.",
        "failed": "Bir şeyler ters gitti: {message}"
      },
      "back": "Tüm şablonlar",
      "save": "Kaydet",
      "saving": "Kaydediliyor…",
      "language": "Dil",
      "subject": "Konu",
      "preheader": "Önizleme metni",
      "noPreheader": "Yok",
      "preview": {
        "heading": "Önizleme",
        "desktop": "Masaüstü",
        "phone": "Telefon",
        "frameTitle": "E-posta önizlemesi, {width} piksel genişliğinde",
        "sampleNote": "Birleştirme etiketleri {name} adlı örnek bir aboneyi gösterir. Abone listesi oluşana kadar abonelikten çıkma bağlantısı mağazanın ana sayfasına gider."
      },
      "renderFailed": {
        "invalidDocument": "Bu şablon okunamıyor: {issues}",
        "empty": "Bu şablonun bu dilde henüz gösterecek bir şeyi yok."
      },
      "warningsHeading": "Göz atmaya değer",
      "noWarnings": "Bu dilde düzeltilecek bir şey yok.",
      "warningIn": "{message} (blok {block})",
      "warnings": {
        "invalidBlock": "Bir blok okunamadı ve çıkarıldı.",
        "blockFailed": "Bir blok gösterilemedi ve çıkarıldı.",
        "missingTranslation": "Henüz bu dile çevrilmedi, bu yüzden {language} metni gösteriliyor.",
        "emptyBlock": "Bu dilde metni yok, bu yüzden çıkarıldı.",
        "missingProduct": "Ürün artık mağazada değil, bu yüzden bu blok çıkarıldı.",
        "missingDiscount": "{detail} kodu devre dışı, süresi dolmuş veya tükenmiş, bu yüzden bu blok çıkarıldı.",
        "unknownMergeTag": "Bilinmeyen birleştirme etiketi “{detail}”; yedek metni kullanılıyor.",
        "unsafeUrl": "http(s) veya mailto olmayan bir bağlantı kaldırıldı: {detail}",
        "missingUnsubscribe": "Abonelikten çıkma bağlantısı yok."
      },
      "test": {
        "heading": "Test gönder",
        "intro": "Bu şablonu konuda [Test] ile tek bir adrese gönderir. Birleştirme etiketleri örnek aboneyi kullanır.",
        "to": "Alıcı",
        "language": "Dil",
        "send": "Test gönder",
        "sending": "Gönderiliyor…",
        "subjectPrefix": "[Test]",
        "result": {
          "sent": "{to} adresine gönderildi. Resend mesaj kimliği: {id}.",
          "notConfigured": "Gönderilmedi: e-posta yapılandırılmamış (RESEND_API_KEY ve EMAIL_FROM).",
          "providerError": "Resend e-postayı kabul etmedi: {error}",
          "invalidTemplate": "Gönderilmedi: şablon okunamıyor.",
          "empty": "Gönderilmedi: bu dilde gösterilecek bir şey kalmadı.",
          "invalidRecipient": "Bu bir e-posta adresine benzemiyor.",
          "invalidLocale": "Bu dil mağazanın dillerinden biri değil.",
          "tooSoon": "Bu şablonun bir testi az önce gönderildi. Birkaç saniye bekleyip tekrar deneyin.",
          "notFound": "Bu şablon artık yok.",
          "notAuthorized": "Test göndermeyi yalnızca mağaza sahibi yapabilir.",
          "failed": "Bir şeyler ters gitti: {error}"
        },
        "details": "{duration} ms, {count, plural, =0 {uyarı yok} one {# uyarı} other {# uyarı}}",
        "logged": "Günlüğe yazıldı: {file}",
        "notLogged": "Günlüğe yazılamadı: {error}"
      },
      "designer": {
        "undo": "Geri al",
        "redo": "Yinele",
        "saveBlocked": "Kaydetmeden önce düzeltilecek {count, plural, one {# sorun} other {# sorun}} var.",
        "unsaved": "Kaydedilmemiş değişiklikler",
        "saved": "Tüm değişiklikler kaydedildi",
        "reset": "Bu şablon okunamadı, bu yüzden boş bir e-postayla başlıyorsunuz. Kaydetmek onun yerini alır.",
        "dropped": "{count, plural, one {# blok} other {# blok}} okunamadı ve çıkarıldı. Kaydetmek geri kalanı korur.",
        "settingsHeading": "E-posta ayarları",
        "problems": "{count, plural, one {# sorun} other {# sorun}}",
        "addBlock": "Blok ekle",
        "previewWaiting": "Önizleme, e-postanın ana dilde bir konusu olduğunda görünür.",
        "testUsesSaved": "Testler son kaydedilen sürümü gönderir. Değişikliklerinizi test etmek için önce kaydedin.",
        "editingLanguage": "Dil",
        "defaultLanguage": "{locale} (ana)",
        "missingCount": "{count, plural, one {# alan} other {# alan}} çevrilmedi",
        "untranslatedBadge": "Çevrilmedi",
        "notTranslated": "Henüz çevrilmedi: bu dildeki okuyucular {language} metnini görür.",
        "copyFrom": "{language} metniyle başla",
        "addToColumn": "{number}. sütuna ekle",
        "dropHere": "Buraya bırakın",
        "empty": "Bu e-posta boş. Başlamak için bir blok ekleyin.",
        "linkInvalid": "Adres https://, http:// veya mailto: ile başlamalı",
        "blocks": {
          "heading": "Başlık",
          "text": "Metin",
          "image": "Görsel",
          "button": "Düğme",
          "product": "Ürün",
          "discount": "İndirim kodu",
          "divider": "Ayırıcı",
          "spacer": "Boşluk",
          "columns": "Sütunlar"
        },
        "blockHints": {
          "heading": "Büyük harflerle bir başlık",
          "text": "Kalın yazı, bağlantılar, listeler ve renklerle paragraflar",
          "image": "İsterseniz bağlantılı bir görsel",
          "button": "Dokunulacak bir bağlantı",
          "product": "Görseli, fiyatı ve düğmesiyle bir ürün",
          "discount": "Ödemede girilecek bir kod",
          "divider": "İnce bir çizgi",
          "spacer": "Boş alan",
          "columns": "Yan yana iki veya üç blok"
        },
        "newBlock": {
          "heading": "Yeni bir başlık",
          "text": "Buraya bir şeyler yazın.",
          "button": "Hemen alışveriş yapın"
        },
        "actions": {
          "drag": "Taşımak için sürükleyin",
          "moveUp": "Yukarı taşı",
          "moveDown": "Aşağı taşı",
          "duplicate": "Kopyala",
          "remove": "Kaldır"
        },
        "links": {
          "home": "Mağaza ana sayfası",
          "shop": "Tüm ürünler"
        },
        "mergeTags": {
          "button": "Kişisel bilgiler",
          "fallbackName": "değerli müşterimiz",
          "subscriber_first_name": "Ad",
          "subscriber_email": "E-posta adresi",
          "shop_name": "Mağaza adı",
          "shop_url": "Mağaza adresi",
          "shop_locale_url": "Kendi dilinde mağaza adresi",
          "unsubscribe_url": "Abonelikten çıkma bağlantısı",
          "current_year": "Bu yıl"
        },
        "toolbar": {
          "style": "Metin stili",
          "paragraph": "Normal metin",
          "heading1": "Büyük başlık",
          "heading2": "Orta başlık",
          "heading3": "Küçük başlık",
          "bold": "Kalın",
          "italic": "İtalik",
          "underline": "Altı çizili",
          "strike": "Üstü çizili",
          "fontSize": "Yazı boyutu",
          "defaultSize": "Boyut",
          "color": "Yazı rengi",
          "defaultColor": "Renk",
          "brandColor": "Marka rengi",
          "bulletList": "Madde işaretli liste",
          "orderedList": "Numaralı liste",
          "alignLeft": "Sola hizala",
          "alignCenter": "Ortala",
          "alignRight": "Sağa hizala",
          "link": "Bağlantı",
          "unlink": "Bağlantıyı kaldır",
          "linkPlaceholder": "https://…",
          "linkShop": "Tüm ürünler",
          "apply": "Uygula",
          "cancel": "İptal",
          "linkInvalid": "Adres https://, http:// veya mailto: ile başlamalı"
        },
        "fields": {
          "subject": "Konu",
          "subjectHint": "Gelen kutusunda görünen metin.",
          "preheader": "Önizleme metni",
          "preheaderHint": "Çoğu gelen kutusunda konudan sonra gösterilir.",
          "footer": "Alt bilgi",
          "footerHint": "İşletme adınız ve posta adresiniz. Birçok ülke pazarlama e-postalarında bunları zorunlu tutar.",
          "headingText": "Başlık",
          "level": "Boyut",
          "levels": {
            "1": "Büyük",
            "2": "Orta",
            "3": "Küçük"
          },
          "align": "Hizalama",
          "aligns": {
            "start": "Başa",
            "center": "Ortaya",
            "end": "Sona"
          },
          "imageUrl": "Görsel",
          "chooseImage": "Bir görsel yükleyin veya https:// adresini yapıştırın.",
          "upload": "Görsel yükle",
          "uploading": "Yükleniyor…",
          "uploadFailed": "Yükleme başarısız oldu: {message}",
          "alt": "Açıklama",
          "altHint": "Görselleri göremeyenlere okunur ve görseller engellendiğinde gösterilir.",
          "link": "Bağlantı",
          "linkOptional": "Bağlantı (isteğe bağlı)",
          "width": "Genişlik",
          "label": "Etiket",
          "color": "Renk",
          "useBrandColor": "Marka rengini kullan",
          "defaultColor": "Varsayılan renk",
          "fullWidth": "Tam genişlik",
          "product": "Ürün",
          "chooseProduct": "Listeden bir ürün seçin veya arayın.",
          "productMissing": "Bu ürün artık mağazada değil. Başka birini seçin.",
          "searchProducts": "Ürün ara",
          "noProducts": "Ürün bulunamadı.",
          "showPrice": "Fiyatı göster",
          "buttonLabel": "Düğme etiketi",
          "leaveEmptyFor": "“{text}” için boş bırakın.",
          "discount": "Kod",
          "chooseDiscount": "Bir kod seçin",
          "noDiscounts": "Etkin indirim kodu yok. Önce İndirim kodları bölümünden bir tane oluşturun.",
          "discountScheduled": "{code} (daha sonra başlar)",
          "discountMissing": "{code} kodu devre dışı, süresi dolmuş veya tükenmiş. Başka birini seçin.",
          "title": "Başlık",
          "note": "Not",
          "height": "Yükseklik",
          "layout": "Düzen",
          "layouts": {
            "1-1": "İki eşit",
            "1-2": "Dar ve geniş",
            "2-1": "Geniş ve dar",
            "1-1-1": "Üç eşit"
          },
          "stackOnMobile": "Telefonlarda alt alta",
          "column": "{number}. sütun",
          "emptyColumn": "Henüz boş."
        },
        "theme": {
          "heading": "Görünüm",
          "brandColor": "Marka rengi",
          "textColor": "Metin",
          "backgroundColor": "Arka plan",
          "contentColor": "E-posta gövdesi",
          "font": "Yazı tipi",
          "fonts": {
            "system": "Modern",
            "sans": "Klasik tırnaksız",
            "serif": "Tırnaklı"
          },
          "logo": "Logo",
          "logoWidth": "Logo genişliği",
          "removeLogo": "Logoyu kaldır"
        }
      }
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
        "heatChip": "Acılık: {value}",
        "categoryChip": "Kategori: {value}",
        "allChilliTypes": "Tüm biber türleri",
        "sortMildToHot": "Hafiften acıya",
        "sortHotToMild": "Acıdan hafife"
      }
    },
    "results": {
      "noResults": "Sonuç yok",
      "adjustSearch": "Farklı bir arama veya filtre deneyin.",
      "showingCount": "{total} üründen {shown} tanesi gösteriliyor",
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
    "country": "Ülke",
    "selectCountry": "Ülke seçin",
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
    "discount": "İndirim ({code})",
    "freeShipping": "Ücretsiz kargo ({code})",
    "discountInvalid": "Promosyon kodunuz artık geçerli değil ve kaldırıldı. Ödemeden önce toplamı kontrol edin.",
    "total": "Toplam",
    "shipTo": "Teslimat adresi",
    "createAccountTitle": "Bu siparişi takip edin",
    "createAccountBody": "{email} ile bir hesap oluşturun; e-posta adresinizi doğruladığınızda bu sipariş hesabınıza kaydedilir.",
    "createAccount": "Hesap oluştur",
    "savedToAccount": "Bu sipariş hesabınıza kaydedildi.",
    "addressAtStripe": "Teslimat adresinizi güvenli ödeme sayfasında gireceksiniz."
  },
  "Email": {
    "shipping": {
      "subject": "{shop}: {reference} numaralı siparişiniz kargolandı",
      "headline": "Siparişiniz yolda",
      "intro": "İyi haber: {reference} numaralı siparişiniz kargo firmasına teslim edildi.",
      "tracking": "Kargo takibi",
      "carrier": "Kargo firması",
      "trackingNumber": "Takip numarası",
      "track": "Kargonuzu takip edin",
      "items": "Pakette neler var",
      "address": "Teslimat adresi",
      "viewOrders": "Siparişlerinizi görüntüleyin",
      "footer": "Sorunuz mu var? Bu e-postayı yanıtlamanız yeterli."
    },
    "confirmation": {
      "subject": "{shop}: {reference} numaralı siparişiniz onaylandı",
      "headline": "Siparişiniz için teşekkürler",
      "order": "Sipariş {reference}",
      "subtotal": "Ara toplam",
      "shipping": "Kargo",
      "discount": "İndirim",
      "total": "Toplam",
      "address": "Teslimat adresi",
      "viewOrder": "Siparişinizi görüntüleyin",
      "footer": "Siparişiniz kargoya verildiğinde size tekrar e-posta göndereceğiz."
    },
    "refund": {
      "subject": "{shop}: {reference} numaralı sipariş için {amount} iade",
      "headlineFull": "Siparişiniz iade edildi",
      "headlinePartial": "İadeniz yolda",
      "summaryFull": "{reference} numaralı siparişin tamamı olan {total} iade edildi.",
      "summaryPartial": "{reference} numaralı siparişten {amount} iade edildi.",
      "refundedSoFar": "Şimdiye kadar iade edilen: {total} tutarının {refunded} kadarı.",
      "viewOrders": "Siparişlerinizi görüntüleyin",
      "footer": "Para, ödeme yaptığınız karta veya hesaba geri gönderilir. Bankalar genellikle 5 ila 10 iş günü içinde gösterir."
    },
    "campaign": {
      "footerReason": "{shop} bültenine abone olduğunuz için bu e-postayı alıyorsunuz.",
      "unsubscribe": "Abonelikten çık",
      "viewProduct": "Ürünü görüntüle",
      "discountTitle": "Kodunuz",
      "discountHint": "Sepetinizde veya ödeme sırasında girin.",
      "discountPercent": "%{percent} indirim",
      "discountAmount": "{amount} indirim",
      "discountFreeShipping": "Ücretsiz kargo"
    }
  },
  "Home": {
    "__after__": "Nav",
    "tagline": "{shop} mağazasına hoş geldiniz",
    "browse": "Mağazaya göz atın"
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
    "Account": "الحساب",
    "Home": "الرئيسية"
  },
  "Account": {
    "ordersTitle": "طلباتك",
    "noOrders": "لم تقم بأي طلب بعد.",
    "startShopping": "ابدأ التسوق",
    "orderNumber": "الطلب {number}",
    "total": "الإجمالي",
    "discount": "الخصم ({code})",
    "shippedOn": "تم الشحن في {date}",
    "trackingNumber": "رقم التتبع {number}",
    "track": "تتبّع طردك",
    "refundedAmount": "تم استرداد {amount}",
    "status": {
      "pending": "قيد الانتظار",
      "paid": "مدفوع",
      "fulfilled": "تم الشحن",
      "cancelled": "ملغى",
      "refunded": "مسترد"
    }
  },
  "Shop": {
    "title": "المتجر",
    "empty": "لا توجد منتجات بعد."
  },
  "Product": {
    "backToShop": "العودة إلى المتجر",
    "noImage": "لا توجد صورة بعد",
    "imageAlt": "{name}، الصورة {index} من {count}",
    "galleryLabel": "صور المنتج",
    "showImage": "عرض الصورة {index} من {count}",
    "wasPrice": "السعر السابق {price}",
    "inStock": "متوفر",
    "lowStock": "لم يتبقَّ سوى {count}",
    "backorder": "متاح للطلب، يُشحن عند توفره",
    "soldOut": "نفدت الكمية",
    "brand": "العلامة التجارية",
    "category": "الفئة",
    "tags": "الوسوم",
    "about": "عن هذا المنتج",
    "facts": "تفاصيل المنتج",
    "netContent": "المحتوى الصافي",
    "weight": "الوزن",
    "dimensions": "الأبعاد",
    "countryOfOrigin": "بلد المنشأ",
    "ingredients": "المكونات",
    "allergens": "مسببات الحساسية",
    "dietary": "النظام الغذائي",
    "storage": "التخزين",
    "bestBefore": "يُفضَّل استهلاكه قبل",
    "nutritionTitle": "القيمة الغذائية لكل 100 غ / مل",
    "nutrition": {
      "energy_kj": "الطاقة (كيلوجول)",
      "energy_kcal": "الطاقة (سعرة حرارية)",
      "fat_g": "الدهون (غ)",
      "saturated_fat_g": "منها دهون مشبعة (غ)",
      "carbohydrate_g": "الكربوهيدرات (غ)",
      "sugar_g": "منها سكريات (غ)",
      "protein_g": "البروتين (غ)",
      "salt_g": "الملح (غ)"
    },
    "dietaryFlags": {
      "vegan": "نباتي صرف",
      "vegetarian": "نباتي",
      "gluten-free": "خالٍ من الغلوتين",
      "dairy-free": "خالٍ من منتجات الألبان",
      "nut-free": "خالٍ من المكسرات",
      "organic": "عضوي"
    },
    "units": {
      "pieces": "قطعة"
    },
    "heat": "الحرارة",
    "heatMeter": "درجة الحرارة {level} من {max}",
    "scoville": "{shu} وحدة سكوفيل",
    "chilliTypes": "أنواع الفلفل"
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
    "quantity": "الكمية",
    "increase": "زيادة الكمية",
    "decrease": "تقليل الكمية",
    "remove": "إزالة",
    "clear": "إفراغ السلة",
    "subtotal": "المجموع الفرعي",
    "shippingAtCheckout": "يتم احتساب الشحن عند الدفع.",
    "checkout": "إتمام الشراء",
    "continueShopping": "متابعة التسوق",
    "discount": {
      "label": "رمز الخصم",
      "placeholder": "أدخل الرمز",
      "apply": "تطبيق",
      "applying": "جارٍ التحقق...",
      "remove": "إزالة",
      "applied": "تم تطبيق الرمز {code}",
      "line": "الخصم ({code})",
      "shipping": "الشحن",
      "freeShipping": "مجاني مع {code}",
      "total": "الإجمالي",
      "errors": {
        "invalid_format": "لا يبدو هذا رمزًا. تتكون الرموز من 3 إلى 32 حرفًا أو رقمًا أو شرطة أو شرطة سفلية.",
        "not_found": "لا نتعرف على هذا الرمز. تحقق من كتابته وحاول مجددًا.",
        "inactive": "لم يعد هذا الرمز فعّالًا.",
        "not_started": "هذا الرمز غير صالح بعد.",
        "expired": "انتهت صلاحية هذا الرمز.",
        "exhausted": "استُخدم هذا الرمز أقصى عدد ممكن من المرات.",
        "min_subtotal": "يتطلب هذا الرمز طلبًا بقيمة {minimum} على الأقل.",
        "currency_mismatch": "هذا الرمز لعملة مختلفة.",
        "nothing_to_discount": "الشحن مجاني بالفعل لهذا الطلب، لذا لن يغيّر هذا الرمز شيئًا.",
        "failed": "تعذّر تطبيق الرمز الآن. يرجى المحاولة مرة أخرى."
      }
    }
  },
  "Admin": {
    "title": "Store admin",
    "dashboardHeading": "Manage your catalogue",
    "dashboardWelcomeHeading": "You're in control",
    "dashboardWelcomeCopy": "Use the admin panel to add new sauces, edit listings, and keep imagery fresh.",
    "nav": {
      "dashboard": "Dashboard",
      "products": "Products",
      "newProduct": "New product",
      "orders": "الطلبات",
      "discounts": "رموز الخصم",
      "seo": "البحث وMerchant Center",
      "email": "البريد"
    },
    "stats": {
      "products": "Products",
      "brands": "Brands",
      "categories": "Categories"
    },
    "orders": {
      "heading": "الطلبات",
      "subheading": "كل الطلبات المدفوعة، الأحدث أولًا. افتح الطلب لاسترداد قيمته عبر Stripe.",
      "order": "الطلب {number}",
      "status": "الحالة",
      "save": "حفظ",
      "tracking": "التتبع (اختياري، يُحفظ عندما تكون الحالة «تم الشحن»)",
      "carrier": "شركة الشحن",
      "trackingNumber": "رقم التتبع",
      "trackingUrl": "رابط التتبع",
      "trackingUrlHint": "اتركه فارغًا لاستخدام صفحة شركة الشحن للشركات المعروفة.",
      "autoEmailHint": "تغيير الحالة إلى «تم الشحن» يرسل رسالة واحدة إلى العميل. التبديل ذهابًا وإيابًا لا يرسل رسالة أخرى.",
      "shippedOn": "تم الشحن {date}",
      "customerNotified": "تم إشعار العميل {date}",
      "customerNotNotified": "لم يتم إشعار العميل بالشحن",
      "sendShippingEmail": "إرسال رسالة الشحن",
      "resendShippingEmail": "إعادة إرسال رسالة الشحن",
      "shippingEmailSent": "تم إرسال رسالة الشحن إلى {email}.",
      "shippingEmailOff": "البريد الإلكتروني غير مُعدّ، لذا لم تُرسل رسالة الشحن.",
      "shippingEmailFailed": "تعذّر إرسال رسالة الشحن: {error}",
      "statusSaved": "تم حفظ الحالة.",
      "statusFailed": "تعذّر حفظ الحالة: {error}",
      "total": "الإجمالي",
      "discount": "الخصم ({code})",
      "refundedSoFar": "تم استرداد {amount}",
      "details": "التفاصيل وعمليات الاسترداد",
      "empty": "لا توجد طلبات بعد."
    },
    "refund": {
      "heading": "استرداد",
      "subheading": "يُعاد المبلغ عبر Stripe إلى البطاقة التي دفع بها العميل. لا يمكن التراجع عن هذا الإجراء.",
      "backToOrders": "العودة إلى الطلبات",
      "remaining": "المتاح للاسترداد: {amount}",
      "nothingLeft": "تم استرداد قيمة هذا الطلب بالكامل.",
      "notRefundable": "يمكن استرداد الطلبات المدفوعة أو المشحونة فقط.",
      "noPayment": "لا توجد دفعة Stripe لهذا الطلب يمكن استردادها.",
      "kind": "ما الذي تريد استرداده؟",
      "kindFull": "باقي الطلب ({amount})",
      "kindItems": "منتجات محددة",
      "kindPercent": "نسبة مئوية من إجمالي الطلب",
      "kindAmount": "مبلغ محدد",
      "itemQuantity": "عدد الوحدات المراد استردادها",
      "itemRefunded": "تم استرداد {count} سابقًا",
      "percentLabel": "نسبة من {total}",
      "amountLabel": "المبلغ بعملة {currency}",
      "reason": "ملاحظة للعميل (اختياري)",
      "reasonHint": "تُدرج في رسالة الاسترداد.",
      "preview": "مبلغ الاسترداد: {amount}",
      "confirmLabel": "اكتب {word} للتأكيد",
      "submit": "استرداد {amount}",
      "submitting": "جارٍ الاسترداد...",
      "success": "تم استرداد {amount}. رقم الاسترداد في Stripe: {id}.",
      "emailSent": "تم إرسال رسالة إلى العميل.",
      "emailOff": "البريد الإلكتروني غير مُعدّ، لذا لم يتم إشعار العميل.",
      "emailFailed": "تعذّر إرسال رسالة إلى العميل: {error}",
      "errors": {
        "not_authorized": "غير مسموح لك بذلك.",
        "not_confirmed": "اكتب {word} لتأكيد الاسترداد.",
        "not_found": "الطلب غير موجود.",
        "no_payment": "لا توجد دفعة Stripe لهذا الطلب يمكن استردادها.",
        "not_refundable": "يمكن استرداد الطلبات المدفوعة أو المشحونة فقط.",
        "nothing_left": "تم استرداد قيمة هذا الطلب بالكامل.",
        "no_items": "اختر منتجًا واحدًا على الأقل.",
        "unknown_item": "أحد المنتجات ليس ضمن هذا الطلب.",
        "item_quantity": "لا يمكنك استرداد وحدات أكثر مما طُلب.",
        "bad_percent": "أدخل نسبة بين 0 و100.",
        "bad_amount": "أدخل مبلغًا أكبر من صفر.",
        "exceeds_remaining": "هذا أكثر من المبلغ المتبقي للاسترداد.",
        "stripe": "رفض Stripe عملية الاسترداد: {message}",
        "failed": "تعذّر تسجيل عملية الاسترداد: {message}"
      },
      "history": "سجل الاسترداد",
      "historyEmpty": "لا توجد عمليات استرداد بعد.",
      "kinds": {
        "full": "باقي الطلب",
        "items": "منتجات",
        "percent": "{percent}٪ من الإجمالي",
        "amount": "مبلغ"
      },
      "statuses": {
        "pending": "قيد الانتظار",
        "succeeded": "تم الاسترداد",
        "failed": "فشل"
      },
      "customerEmailed": "تم إشعار العميل",
      "customerNotEmailed": "لم يتم إشعار العميل"
    },
    "discounts": {
      "heading": "رموز الخصم",
      "subheading": "تُنشأ رموز النسبة والمبلغ في Stripe أيضًا ويطبّقها Stripe عند الدفع. أما رموز الشحن المجاني فيطبّقها المتجر. يُتحقق من الرمز عند إدخاله ومرة أخرى عند الدفع.",
      "newHeading": "رمز جديد",
      "code": "الرمز",
      "codeHint": "من 3 إلى 32 حرفًا أو رقمًا أو شرطة أو شرطة سفلية. يكتبه العملاء كما هو؛ لا فرق بين الأحرف الكبيرة والصغيرة.",
      "kind": "النوع",
      "kinds": {
        "percent": "خصم بنسبة مئوية",
        "amount": "خصم بمبلغ",
        "free_shipping": "شحن مجاني"
      },
      "percent": "النسبة",
      "amount": "المبلغ",
      "currency": "العملة (ثلاثة أحرف، مثل EUR)",
      "minSubtotal": "الحد الأدنى للطلب (اختياري)",
      "startsAt": "صالح من (اختياري)",
      "endsAt": "صالح حتى (اختياري)",
      "maxRedemptions": "الحد الأقصى للاستخدام (اختياري)",
      "create": "إنشاء الرمز",
      "creating": "جارٍ الإنشاء...",
      "created": "تم إنشاء الرمز {code}.",
      "empty": "لا توجد رموز بعد.",
      "columns": {
        "code": "الرمز",
        "value": "القيمة",
        "restrictions": "القيود",
        "uses": "الاستخدامات",
        "status": "الحالة",
        "actions": "الإجراءات"
      },
      "status": {
        "active": "فعّال",
        "scheduled": "مجدول",
        "expired": "منتهٍ",
        "exhausted": "مستنفد",
        "retired": "متوقف"
      },
      "retire": "إيقاف",
      "reactivate": "إعادة التفعيل",
      "delete": "حذف",
      "deleteConfirm": "هل تريد حذف هذا الرمز؟ لا يمكن حذف إلا الرموز التي لم تُستخدم قط.",
      "retired": "تم إيقاف الرمز {code}. لم يعد بإمكان العملاء استخدامه.",
      "reactivated": "الرمز {code} فعّال من جديد.",
      "deleted": "تم حذف الرمز {code}.",
      "usesOf": "{count} من {max}",
      "minLabel": "الحد الأدنى {amount}",
      "from": "من {date}",
      "until": "حتى {date}",
      "noRestrictions": "لا شيء",
      "errors": {
        "code_format": "تتكون الرموز من 3 إلى 32 حرفًا أو رقمًا أو شرطة أو شرطة سفلية.",
        "kind": "اختر نوعًا.",
        "percent": "أدخل نسبة أكبر من 0 وحتى 100.",
        "amount": "أدخل مبلغًا أكبر من صفر، مثل 5 أو 7.50.",
        "currency": "أدخل رمز عملة من ثلاثة أحرف، مثل EUR. رموز المبلغ والحدود الدنيا تحتاج إليه.",
        "min_subtotal": "أدخل الحد الأدنى كمبلغ، مثل 20 أو 20.00.",
        "dates": "تحقق من التواريخ: يجب أن تكون النهاية بعد البداية.",
        "max_redemptions": "أدخل عددًا صحيحًا أكبر من صفر.",
        "duplicate": "هذا الرمز موجود بالفعل.",
        "stripe": "رفض Stripe الرمز: {message}",
        "failed": "تعذّر حفظ الرمز: {message}",
        "in_use": "استُخدم هذا الرمز، لذا لا يمكن حذفه. أوقفه بدلًا من ذلك.",
        "not_found": "الرمز غير موجود.",
        "not_authorized": "غير مسموح لك بذلك."
      }
    },
    "seo": {
      "heading": "البحث وMerchant Center",
      "subheading": "ما يحتاجه Google من هذا المتجر وأين يُلصق. كل صفحة عامة تحمل بالفعل canonical وhreflang وبيانات منظمة؛ هذه الصفحة هي الجانب التشغيلي.",
      "siteUrl": "عنوان الموقع العام",
      "siteUrlHint": "اضبط NEXT_PUBLIC_SITE_URL في البيئة. يُبنى منه كل رابط canonical وhreflang وكل إدخال في خريطة الموقع وكل عنوان خلاصة، لذا يجب أن يكون أصل الإنتاج بالضبط.",
      "verification": "التحقق من الموقع لدى Google",
      "verified": "وسم meta يُعرض (NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION مضبوط).",
      "notVerified": "غير مضبوط. أضف رمز التحقق بوسم HTML من Search Console كقيمة NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION.",
      "sitemap": "خريطة الموقع",
      "sitemapHint": "أرسلها في Search Console. تسرد كل نسخة لغوية من كل صفحة قابلة للفهرسة مع بدائل hreflang.",
      "feeds": "خلاصات منتجات Merchant Center",
      "feedsHint": "خلاصة واحدة لكل لغة. في Merchant Center أضف مصدر منتجات من ملف مستضاف على عنوان URL، واحد لكل بلد ولغة مستهدفين، ووجّهه إلى هنا. يجلبه Google كل 24 ساعة. فعّل التحديثات التلقائية للمنتجات حتى تصحّح البيانات المنظمة للصفحة السعر القديم بدلًا من رفض المنتج.",
      "feedFor": "خلاصة {locale}",
      "locales": "اللغات",
      "localesHint": "كل واحدة بادئة URL لها canonical ومجموعة hreflang خاصة. لغة-بلد (de-at) ترث نصوص لغتها ولا تتجاوز إلا ما يختلف.",
      "checklist": "قائمة التحقق",
      "steps": {
        "verify": "تحقق من الموقع في Search Console وطالب به في Merchant Center بحساب Google نفسه.",
        "sitemap": "أرسل خريطة الموقع في Search Console.",
        "feeds": "أضف مصدر منتجات واحدًا لكل بلد مستهدف في Merchant Center باستخدام عناوين الخلاصات أعلاه، أو دع Merchant Center يقرأ البيانات المنظمة لصفحات المنتجات مباشرة.",
        "identifiers": "املأ العلامة التجارية وSKU والباركود (GTIN) للمنتجات: يرفض Google المنتجات ذات المعرّفات غير الصالحة ويرتّب المنتجات بلا معرّفات أدنى.",
        "shipping": "اضبط سياسات الشحن والإرجاع في Merchant Center؛ فهو يفضّلها على البيانات المنظمة.",
        "currency": "يجب أن تطابق الأسعار والعملة في الصفحات الخلاصة لكل بلد مستهدف. لا تبدّل العملة أبدًا حسب موقع الزائر."
      }
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
    },
    "email": {
      "heading": "حملات البريد الإلكتروني",
      "subheading": "قوالب للنشرات والعروض. اعرضها بكل لغات المتجر وأرسل لنفسك رسالة تجريبية قبل أن يصل أي شيء إلى العملاء.",
      "comingSoon": "الإرسال إلى المشتركين قيد الإعداد؛ حتى ذلك الحين أرسل لنفسك تجربة من أي قالب.",
      "notConfigured": "يتطلب الإرسال التجريبي وجود RESEND_API_KEY وEMAIL_FROM في إعدادات المتجر. المعاينة تعمل بدونهما.",
      "newHeading": "قالب جديد",
      "name": "الاسم",
      "starter": "البدء من",
      "starters": {
        "blank": "فارغ",
        "newsletter": "نشرة إخبارية"
      },
      "create": "إنشاء القالب",
      "creating": "جارٍ الإنشاء…",
      "empty": "لا توجد قوالب بعد. أنشئ قالبًا أعلاه.",
      "columns": {
        "name": "الاسم",
        "updated": "آخر تعديل",
        "lastTest": "آخر تجربة",
        "actions": "الإجراءات"
      },
      "never": "أبدًا",
      "duplicate": "نسخ",
      "delete": "حذف",
      "confirmDelete": "هل تريد حذف القالب “{name}”؟ لا يمكن التراجع عن ذلك.",
      "copySuffix": "(نسخة)",
      "notices": {
        "created": "تم إنشاء القالب “{name}”.",
        "duplicated": "تم النسخ باسم “{name}”.",
        "deleted": "تم حذف القالب “{name}”."
      },
      "errors": {
        "name": "أعطِ القالب اسمًا لا يتجاوز 120 حرفًا.",
        "document": "في القالب {count, plural, one {مشكلة واحدة} other {# مشكلات}} ولم يُحفظ.",
        "tooLarge": "القالب أكبر من أن يُحفظ.",
        "starter": "اختر تصميمًا للبدء منه.",
        "notFound": "هذا القالب لم يعد موجودًا.",
        "notAuthorized": "هذا متاح لصاحب المتجر فقط.",
        "failed": "حدث خطأ: {message}"
      },
      "back": "كل القوالب",
      "save": "حفظ",
      "saving": "جارٍ الحفظ…",
      "language": "اللغة",
      "subject": "الموضوع",
      "preheader": "نص المعاينة",
      "noPreheader": "لا يوجد",
      "preview": {
        "heading": "معاينة",
        "desktop": "سطح المكتب",
        "phone": "الهاتف",
        "frameTitle": "معاينة الرسالة بعرض {width} بكسل",
        "sampleNote": "تعرض وسوم الدمج مشتركًا تجريبيًا اسمه {name}. إلى أن تتوفر قائمة المشتركين، يؤدي رابط إلغاء الاشتراك إلى الصفحة الرئيسية للمتجر."
      },
      "renderFailed": {
        "invalidDocument": "تتعذر قراءة هذا القالب: {issues}",
        "empty": "لا يعرض هذا القالب شيئًا بهذه اللغة بعد."
      },
      "warningsHeading": "يستحق المراجعة",
      "noWarnings": "لا شيء يحتاج إلى إصلاح بهذه اللغة.",
      "warningIn": "{message} (الكتلة {block})",
      "warnings": {
        "invalidBlock": "تعذرت قراءة كتلة فتم حذفها.",
        "blockFailed": "تعذر عرض كتلة فتم حذفها.",
        "missingTranslation": "لم تُترجم إلى هذه اللغة بعد، لذا يظهر النص بلغة {language}.",
        "emptyBlock": "لا تحتوي على نص بهذه اللغة، لذا تم حذفها.",
        "missingProduct": "المنتج لم يعد في المتجر، لذا حُذفت هذه الكتلة.",
        "missingDiscount": "الرمز {detail} موقوف أو منتهٍ أو مستنفد، لذا حُذفت هذه الكتلة.",
        "unknownMergeTag": "وسم دمج غير معروف “{detail}”؛ يُستخدم نصه البديل.",
        "unsafeUrl": "أُزيل رابط لا يبدأ بـ http(s) أو mailto: {detail}",
        "missingUnsubscribe": "لا يوجد رابط لإلغاء الاشتراك."
      },
      "test": {
        "heading": "إرسال تجربة",
        "intro": "يرسل هذا القالب إلى عنوان واحد مع [Test] في الموضوع. تستخدم وسوم الدمج المشترك التجريبي.",
        "to": "الإرسال إلى",
        "language": "اللغة",
        "send": "إرسال تجربة",
        "sending": "جارٍ الإرسال…",
        "subjectPrefix": "[Test]",
        "result": {
          "sent": "أُرسلت إلى {to}. معرّف رسالة Resend: {id}.",
          "notConfigured": "لم تُرسل: البريد غير مُعد (RESEND_API_KEY وEMAIL_FROM).",
          "providerError": "لم يقبل Resend الرسالة: {error}",
          "invalidTemplate": "لم تُرسل: تتعذر قراءة القالب.",
          "empty": "لم تُرسل: لم يبقَ ما يُعرض بهذه اللغة.",
          "invalidRecipient": "لا يبدو هذا عنوان بريد إلكتروني.",
          "invalidLocale": "هذه اللغة ليست من لغات المتجر.",
          "tooSoon": "أُرسلت تجربة لهذا القالب قبل لحظات. انتظر بضع ثوانٍ وحاول مجددًا.",
          "notFound": "هذا القالب لم يعد موجودًا.",
          "notAuthorized": "إرسال التجارب متاح لصاحب المتجر فقط.",
          "failed": "حدث خطأ: {error}"
        },
        "details": "{duration} مللي ثانية، {count, plural, =0 {لا تنبيهات} one {تنبيه واحد} other {# تنبيهات}}",
        "logged": "سُجلت في {file}",
        "notLogged": "لم تُسجل: {error}"
      },
      "designer": {
        "undo": "تراجع",
        "redo": "إعادة",
        "saveBlocked": "{count, plural, one {مشكلة واحدة} other {# مشكلات}} يجب إصلاحها قبل الحفظ.",
        "unsaved": "تغييرات غير محفوظة",
        "saved": "حُفظت كل التغييرات",
        "reset": "تعذرت قراءة هذا القالب، لذا تبدأ برسالة فارغة. الحفظ يستبدله.",
        "dropped": "تعذرت قراءة {count, plural, one {كتلة واحدة} other {# كتل}} فحُذفت. الحفظ يُبقي الباقي.",
        "settingsHeading": "إعدادات الرسالة",
        "problems": "{count, plural, one {مشكلة واحدة} other {# مشكلات}}",
        "addBlock": "إضافة كتلة",
        "previewWaiting": "تظهر المعاينة عندما يكون للرسالة موضوع باللغة الرئيسية.",
        "testUsesSaved": "ترسل التجارب آخر نسخة محفوظة. احفظ أولًا لتجربة تغييراتك.",
        "editingLanguage": "اللغة",
        "defaultLanguage": "{locale} (الرئيسية)",
        "missingCount": "{count, plural, one {حقل واحد} other {# حقول}} بلا ترجمة",
        "untranslatedBadge": "بلا ترجمة",
        "notTranslated": "لم تُترجم بعد: يرى القراء بهذه اللغة النص بلغة {language}.",
        "copyFrom": "البدء من النص بلغة {language}",
        "addToColumn": "إضافة إلى العمود {number}",
        "dropHere": "أفلت هنا",
        "empty": "هذه الرسالة فارغة. أضف كتلة للبدء.",
        "linkInvalid": "يجب أن يبدأ العنوان بـ https:// أو http:// أو mailto:",
        "blocks": {
          "heading": "عنوان",
          "text": "نص",
          "image": "صورة",
          "button": "زر",
          "product": "منتج",
          "discount": "رمز خصم",
          "divider": "فاصل",
          "spacer": "مسافة",
          "columns": "أعمدة"
        },
        "blockHints": {
          "heading": "عنوان بحروف كبيرة",
          "text": "فقرات بخط عريض وروابط وقوائم وألوان",
          "image": "صورة، مع رابط إن شئت",
          "button": "رابط يُنقر عليه",
          "product": "منتج بصورته وسعره وزر",
          "discount": "رمز يُدخل عند الدفع",
          "divider": "خط رفيع",
          "spacer": "مساحة فارغة",
          "columns": "كتلتان أو ثلاث جنبًا إلى جنب"
        },
        "newBlock": {
          "heading": "عنوان جديد",
          "text": "اكتب شيئًا هنا.",
          "button": "تسوق الآن"
        },
        "actions": {
          "drag": "اسحب للنقل",
          "moveUp": "نقل لأعلى",
          "moveDown": "نقل لأسفل",
          "duplicate": "نسخ",
          "remove": "إزالة"
        },
        "links": {
          "home": "الصفحة الرئيسية للمتجر",
          "shop": "كل المنتجات"
        },
        "mergeTags": {
          "button": "بيانات شخصية",
          "fallbackName": "عزيزي العميل",
          "subscriber_first_name": "الاسم الأول",
          "subscriber_email": "عنوان بريده",
          "shop_name": "اسم المتجر",
          "shop_url": "عنوان المتجر",
          "shop_locale_url": "عنوان المتجر بلغته",
          "unsubscribe_url": "رابط إلغاء الاشتراك",
          "current_year": "السنة الحالية"
        },
        "toolbar": {
          "style": "نمط النص",
          "paragraph": "نص عادي",
          "heading1": "عنوان كبير",
          "heading2": "عنوان متوسط",
          "heading3": "عنوان صغير",
          "bold": "عريض",
          "italic": "مائل",
          "underline": "تسطير",
          "strike": "يتوسطه خط",
          "fontSize": "حجم الخط",
          "defaultSize": "الحجم",
          "color": "لون النص",
          "defaultColor": "اللون",
          "brandColor": "لون العلامة",
          "bulletList": "قائمة نقطية",
          "orderedList": "قائمة مرقمة",
          "alignLeft": "محاذاة لليسار",
          "alignCenter": "توسيط",
          "alignRight": "محاذاة لليمين",
          "link": "رابط",
          "unlink": "إزالة الرابط",
          "linkPlaceholder": "https://…",
          "linkShop": "كل المنتجات",
          "apply": "تطبيق",
          "cancel": "إلغاء",
          "linkInvalid": "يجب أن يبدأ العنوان بـ https:// أو http:// أو mailto:"
        },
        "fields": {
          "subject": "الموضوع",
          "subjectHint": "ما يظهر في صندوق الوارد.",
          "preheader": "نص المعاينة",
          "preheaderHint": "يظهر بعد الموضوع في معظم صناديق البريد.",
          "footer": "التذييل",
          "footerHint": "اسم نشاطك التجاري وعنوانك البريدي. تشترطهما دول كثيرة في رسائل التسويق.",
          "headingText": "العنوان",
          "level": "الحجم",
          "levels": {
            "1": "كبير",
            "2": "متوسط",
            "3": "صغير"
          },
          "align": "المحاذاة",
          "aligns": {
            "start": "البداية",
            "center": "الوسط",
            "end": "النهاية"
          },
          "imageUrl": "الصورة",
          "chooseImage": "ارفع صورة أو الصق عنوانها https://.",
          "upload": "رفع صورة",
          "uploading": "جارٍ الرفع…",
          "uploadFailed": "فشل الرفع: {message}",
          "alt": "الوصف",
          "altHint": "يُقرأ لمن لا يرى الصور، ويظهر عند حجب الصور.",
          "link": "الرابط",
          "linkOptional": "الرابط (اختياري)",
          "width": "العرض",
          "label": "التسمية",
          "color": "اللون",
          "useBrandColor": "استخدام لون العلامة",
          "defaultColor": "اللون الافتراضي",
          "fullWidth": "بعرض كامل",
          "product": "المنتج",
          "chooseProduct": "اختر منتجًا من القائمة أو ابحث عنه.",
          "productMissing": "هذا المنتج لم يعد في المتجر. اختر غيره.",
          "searchProducts": "البحث عن منتجات",
          "noProducts": "لم يُعثر على منتجات.",
          "showPrice": "إظهار السعر",
          "buttonLabel": "تسمية الزر",
          "leaveEmptyFor": "اتركه فارغًا لاستخدام “{text}”.",
          "discount": "الرمز",
          "chooseDiscount": "اختر رمزًا",
          "noDiscounts": "لا توجد رموز خصم فعالة. أنشئ واحدًا أولًا في رموز الخصم.",
          "discountScheduled": "{code} (يبدأ لاحقًا)",
          "discountMissing": "الرمز {code} موقوف أو منتهٍ أو مستنفد. اختر غيره.",
          "title": "العنوان",
          "note": "ملاحظة",
          "height": "الارتفاع",
          "layout": "التخطيط",
          "layouts": {
            "1-1": "عمودان متساويان",
            "1-2": "ضيق وعريض",
            "2-1": "عريض وضيق",
            "1-1-1": "ثلاثة متساوية"
          },
          "stackOnMobile": "بعضها تحت بعض على الهواتف",
          "column": "العمود {number}",
          "emptyColumn": "فارغ حتى الآن."
        },
        "theme": {
          "heading": "المظهر",
          "brandColor": "لون العلامة",
          "textColor": "النص",
          "backgroundColor": "الخلفية",
          "contentColor": "جسم الرسالة",
          "font": "الخط",
          "fonts": {
            "system": "عصري",
            "sans": "كلاسيكي بلا زوائد",
            "serif": "بزوائد"
          },
          "logo": "الشعار",
          "logoWidth": "عرض الشعار",
          "removeLogo": "إزالة الشعار"
        }
      }
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
        "heatChip": "الحرارة: {value}",
        "categoryChip": "الفئة: {value}",
        "allChilliTypes": "كل أنواع الفلفل",
        "sortMildToHot": "من الخفيف إلى الحار",
        "sortHotToMild": "من الحار إلى الخفيف"
      }
    },
    "results": {
      "noResults": "لا توجد نتائج",
      "adjustSearch": "جرّب بحثًا أو عامل تصفية مختلفًا.",
      "showingCount": "عرض {shown} من أصل {total} منتجًا",
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
    "country": "الدولة",
    "selectCountry": "اختر الدولة",
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
    "discount": "الخصم ({code})",
    "freeShipping": "شحن مجاني ({code})",
    "discountInvalid": "لم يعد رمز الخصم ساريًا وتمت إزالته. يرجى مراجعة الإجمالي قبل الدفع.",
    "total": "الإجمالي",
    "shipTo": "التسليم إلى",
    "createAccountTitle": "تابع هذا الطلب",
    "createAccountBody": "أنشئ حسابًا باستخدام {email} وسيُحفظ هذا الطلب فيه بعد تأكيد بريدك الإلكتروني.",
    "createAccount": "إنشاء حساب",
    "savedToAccount": "تم حفظ هذا الطلب في حسابك.",
    "addressAtStripe": "ستدخل عنوان التسليم في صفحة الدفع الآمنة."
  },
  "Email": {
    "shipping": {
      "subject": "{shop}: تم شحن الطلب {reference}",
      "headline": "طلبك في الطريق إليك",
      "intro": "خبر سار: تم تسليم الطلب {reference} إلى شركة الشحن.",
      "tracking": "التتبع",
      "carrier": "شركة الشحن",
      "trackingNumber": "رقم التتبع",
      "track": "تتبّع طردك",
      "items": "محتويات الطرد",
      "address": "عنوان التسليم",
      "viewOrders": "عرض طلباتك",
      "footer": "لديك سؤال؟ ما عليك سوى الرد على هذه الرسالة."
    },
    "confirmation": {
      "subject": "{shop}: تم تأكيد الطلب {reference}",
      "headline": "شكرًا لطلبك",
      "order": "الطلب {reference}",
      "subtotal": "المجموع الفرعي",
      "shipping": "الشحن",
      "discount": "الخصم",
      "total": "الإجمالي",
      "address": "عنوان التسليم",
      "viewOrder": "عرض طلبك",
      "footer": "سنراسلك مرة أخرى عند شحن طلبك."
    },
    "refund": {
      "subject": "{shop}: استرداد {amount} للطلب {reference}",
      "headlineFull": "تم استرداد قيمة طلبك",
      "headlinePartial": "استردادك في الطريق",
      "summaryFull": "استرددنا كامل المبلغ {total} للطلب {reference}.",
      "summaryPartial": "استرددنا {amount} من الطلب {reference}.",
      "refundedSoFar": "المسترد حتى الآن: {refunded} من {total}.",
      "viewOrders": "عرض طلباتك",
      "footer": "يعود المبلغ إلى البطاقة أو الحساب الذي دفعت به. تعرضه البنوك عادةً خلال 5 إلى 10 أيام عمل."
    },
    "campaign": {
      "footerReason": "تصلك هذه الرسالة لأنك اشتركت في أخبار {shop}.",
      "unsubscribe": "إلغاء الاشتراك",
      "viewProduct": "عرض المنتج",
      "discountTitle": "رمزك",
      "discountHint": "أدخله في سلة التسوق أو عند الدفع.",
      "discountPercent": "خصم {percent}٪",
      "discountAmount": "خصم {amount}",
      "discountFreeShipping": "شحن مجاني"
    }
  },
  "Home": {
    "__after__": "Nav",
    "tagline": "مرحبًا بك في {shop}",
    "browse": "تصفّح المتجر"
  }
}
EOF

# 6) Tailwind v4 RTL support
# Tailwind v4 has native rtl:/ltr: variants built-in via the HTML dir attribute.
# No tailwind.config.ts exists in v4; configuration is CSS-based in globals.css.

# 6a) next-intl v4 request config
mkdir -p src/i18n
LOCALES_ARRAY=$(echo "$LOCALES_CSV" | sed "s|,|', '|g")
cat > src/i18n/config.ts <<EOF
/**
 * Generated by create-next-commerce-template-ssr.sh.
 *
 * The shop's locales as they appear in URLs: a language ("de") or a
 * language-country market ("de-at"). Add a locale here, give it a message
 * file (a market only needs the strings that differ from its language),
 * and every page, hreflang set, sitemap entry and feed follows.
 */
export const LOCALES = ['$LOCALES_ARRAY'] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = '$DEFAULT_LOCALE';
EOF
cat > src/i18n/request.ts <<'EOF'
import { getRequestConfig } from 'next-intl/server';

import { languageOf, mergeMessages } from '@/lib/i18n/locales';
import { DEFAULT_LOCALE, LOCALES } from './config';

type Messages = Record<string, unknown>;

/**
 * Messages for a locale: the language file, with the market file (if the
 * locale is one) merged over it. `de-at` reads `de.json` and overlays
 * whatever `de-at.json` chooses to override.
 */
async function loadMessages(locale: string): Promise<Messages> {
  const language = languageOf(locale);
  const base = (await import(`../messages/${language}.json`)).default as Messages;
  if (language === locale) return base;
  try {
    const overrides = (await import(`../messages/${locale}.json`)).default as Messages;
    return mergeMessages(base, overrides);
  } catch {
    return base;
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !(LOCALES as readonly string[]).includes(locale)) {
    locale = DEFAULT_LOCALE;
  }
  return { locale, messages: await loadMessages(locale) };
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
  images: {
    // Product photos are served from Supabase Storage. next/image refuses
    // any host not listed here, so a self-hosted Supabase needs its own
    // entry.
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.supabase.in' },
    ],
  },
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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * EMAIL_TMP_DIR from the environment or .env.local, which Vitest does not
 * read: the email tests write their previews where the app writes its
 * email logs, never loose in /tmp.
 */
function emailTmpDir(): string {
  if (process.env.EMAIL_TMP_DIR) return process.env.EMAIL_TMP_DIR;
  try {
    const match = readFileSync('.env.local', 'utf8').match(/^EMAIL_TMP_DIR=(.*)$/m);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { EMAIL_TMP_DIR: emailTmpDir() },
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

# 6c) Message files for locales that don't ship with one. A language gets
# a copy of English to translate; a market ("de-at") gets an empty overrides
# file, because it inherits its language's messages and only overrides what
# differs.
for loc in $(echo "$LOCALES_CSV" | tr ',' ' '); do
  lang="${loc%%-*}"
  if [ "$lang" != "$loc" ]; then
    if [ ! -f "src/messages/${lang}.json" ]; then
      cp src/messages/en.json "src/messages/${lang}.json"
    fi
    if [ ! -f "src/messages/${loc}.json" ]; then
      echo "{}" > "src/messages/${loc}.json"
    fi
  elif [ ! -f "src/messages/${loc}.json" ]; then
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
# create-next-app's root layout and page go: [locale]/layout.tsx is the root
# layout (the next-intl setup), so there is one <html> with the right lang,
# not one nested in another. "/" is redirected to a locale by the proxy.
rm -f src/app/layout.tsx src/app/page.tsx
# create-next-app already generated route types for those two files into
# .next/types; stale, they fail tsc. The build regenerates them.
rm -rf .next
mkdir -p src/app/[locale]
cat > src/app/[locale]/layout.tsx <<'EOF'
import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale, getMessages } from 'next-intl/server';
import '../globals.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Header from '@/components/Header';
import { parseLocale } from '@/lib/i18n/locales';
import { siteUrl } from '@/lib/seo/alternates';
import { googleSiteVerification, shopName } from '@/lib/seo/store';

export const dynamic = 'force-dynamic';

/**
 * Site-wide head defaults. metadataBase makes every relative URL in page
 * metadata absolute (Google requires absolute canonical and hreflang
 * URLs); the pages add their own canonical, hreflang set and description.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: shopName(), template: `%s | ${shopName()}` },
  applicationName: shopName(),
  ...(googleSiteVerification() ? { verification: { google: googleSiteVerification() } } : {})
};

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
  // `de-at` in the URL, `de-AT` on the document: what validators and
  // screen readers expect.
  const { hreflang, dir } = parseLocale(locale);

  return (
    <html lang={hreflang} dir={dir} suppressHydrationWarning>
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
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import JsonLd from '@/components/seo/JsonLd';
import { hreflangOf } from '@/lib/i18n/locales';
import { localizedUrl, pageAlternates } from '@/lib/seo/alternates';
import { onlineStoreJsonLd, webSiteJsonLd } from '@/lib/seo/jsonld';
import { logoUrl, returnPolicy, shippingPolicy, shopName } from '@/lib/seo/store';
import { CHECKOUT_CONFIG } from '@/lib/checkout/config';

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Home' });
  return {
    description: t('tagline', { shop: shopName() }),
    alternates: pageAlternates(locale, ''),
    openGraph: { type: 'website', siteName: shopName(), locale: hreflangOf(locale), url: localizedUrl(locale, '') }
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Home' });
  const tNav = await getTranslations({ locale, namespace: 'Nav' });
  const name = shopName();
  const url = localizedUrl(locale, '');

  return (
    <main className="mx-auto max-w-3xl p-6">
      {/* The shop itself, once, on the home page: site name, policies. */}
      <JsonLd
        data={[
          onlineStoreJsonLd({
            name,
            url,
            logo: logoUrl(),
            shipping: shippingPolicy(),
            returnPolicy: returnPolicy(CHECKOUT_CONFIG.allowedCountries[0])
          }),
          webSiteJsonLd({ name, url, inLanguage: hreflangOf(locale) })
        ]}
      />
      <h1 className="mb-2 text-3xl font-bold">{name}</h1>
      <p className="mb-6 text-gray-600">{t('tagline', { shop: name })}</p>
      <nav className="flex flex-wrap gap-4">
        <Link href={`/${locale}/shop`} className="rounded-md bg-black px-4 py-2 font-semibold text-white hover:bg-gray-800">
          {t('browse')}
        </Link>
        <Link href={`/${locale}/cart`} className="underline">{tNav('Cart')}</Link>
        <Link href={`/${locale}/account/orders`} className="underline">{tNav('Account')}</Link>
      </nav>
    </main>
  );
}
EOF

# 9b) Baseline checkout config (which countries the shop delivers to). The
# extend script rewrites this file from its --shipping flag; it exists here
# so the structured data on the product and home pages can name the
# delivery countries even before the extend script has run.
mkdir -p src/lib/checkout
cat > src/lib/checkout/config.ts <<'EOF'
/**
 * Checkout configuration.
 *
 * Written by extend-commerce-template.sh from --shipping=form|stripe.
 * Edit by hand or re-run the script to change it.
 */
export const CHECKOUT_CONFIG = {
  /**
   * 'form':   the /checkout page collects the delivery address.
   * 'stripe': Stripe's payment page collects it (shipping_address_collection).
   */
  shippingAddress: 'form' as 'form' | 'stripe',

  /**
   * Countries the shop delivers to, as ISO 3166-1 alpha-2 codes. The
   * checkout form offers exactly these, and in 'stripe' mode Stripe's page
   * is limited to them too. Placeholder list: replace it with where you
   * actually ship.
   */
  allowedCountries: ['DE', 'AT', 'NL', 'BE', 'FR', 'IE', 'GB'],
} as const;
EOF

# 9c) robots.txt and sitemap.xml, from the same alternates helper the pages
# use, so the sitemap's hreflang set is the one in the <head>.
cat > src/app/robots.ts <<'EOF'
import type { MetadataRoute } from 'next';

import { siteUrl } from '@/lib/seo/alternates';

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        // The feeds are under /api on purpose: Merchant Center fetches them.
        allow: ['/', '/api/feeds/'],
        disallow: ['/api/', '/*/cart', '/*/checkout', '/*/account', '/*/auth', '/*/admin']
      }
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base
  };
}
EOF
cat > src/app/sitemap.ts <<'EOF'
import type { MetadataRoute } from 'next';

import { sitemapEntriesFor } from '@/lib/seo/alternates';
import { createClient } from '@/lib/supabase/server';

// Read at request time: the catalogue changes, and a build must not depend
// on the database being reachable.
export const dynamic = 'force-dynamic';

/**
 * Every indexable page in every locale, each entry carrying the full
 * hreflang set. Cart, checkout, account, auth and admin are noindex and
 * stay out.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();
  const { data: products } = await supabase
    .from('products_public')
    .select('slug, updated_at')
    .order('created_at', { ascending: false });

  return [
    ...sitemapEntriesFor('', { priority: 1 }),
    ...sitemapEntriesFor('/shop', { priority: 0.9 }),
    ...(products ?? []).flatMap((product) =>
      sitemapEntriesFor(`/shop/${product.slug}`, {
        lastModified: product.updated_at ?? undefined,
        priority: 0.8
      })
    )
  ];
}
EOF

# 9d) Merchant Center feed, one per locale, from the same rows and currency
# as the pages. 503 rather than an empty feed when the catalogue can't be
# read: Merchant Center deletes products that vanish from their source.
mkdir -p "src/app/api/feeds/google/[locale]"
cat > "src/app/api/feeds/google/[locale]/route.ts" <<'EOF'
import { NextResponse } from 'next/server';

import { LOCALES } from '@/i18n/config';
import { stockRulesOf, stockStatus } from '@/lib/products/detail';
import { localizedUrl } from '@/lib/seo/alternates';
import { availabilityFor } from '@/lib/seo/jsonld';
import { buildMerchantFeed, type FeedProduct } from '@/lib/seo/merchantFeed';
import { shopName } from '@/lib/seo/store';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

interface FeedRow {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  details: string | null;
  image_url: string | null;
  gallery_urls: string[] | null;
  price_cents: number;
  currency: string;
  stock: number | null;
  track_inventory: boolean | null;
  allow_backorder: boolean | null;
  max_order_quantity: number | null;
  weight_grams: number | null;
  brand_name: string | null;
  category_name: string | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale: raw } = await params;
  // /api/feeds/google/de-de and /api/feeds/google/de-de.xml both work.
  const locale = raw.replace(/\.xml$/, '');
  if (!(LOCALES as readonly string[]).includes(locale)) {
    return new NextResponse('Unknown locale', { status: 404 });
  }

  const { data, error } = await createAdminClient()
    .from('products_public')
    .select(
      'id, name, slug, sku, barcode, description, details, image_url, gallery_urls, price_cents, currency, stock, track_inventory, allow_backorder, max_order_quantity, weight_grams, brand_name, category_name'
    )
    .order('created_at', { ascending: false });

  if (error) {
    return new NextResponse('Catalogue unavailable', { status: 503, headers: { 'Retry-After': '300' } });
  }

  const products: FeedProduct[] = ((data ?? []) as FeedRow[])
    .filter((row) => row.image_url)
    .map((row) => ({
      id: row.id,
      title: row.name,
      description: row.details || row.description,
      link: localizedUrl(locale, `/shop/${row.slug}`),
      images: [row.image_url as string, ...(row.gallery_urls ?? [])],
      priceCents: row.price_cents,
      currency: row.currency,
      availability: availabilityFor(stockStatus(stockRulesOf(row)).kind),
      brand: row.brand_name,
      sku: row.sku,
      barcode: row.barcode,
      category: row.category_name,
      shippingWeightGrams: row.weight_grams
    }));

  const xml = buildMerchantFeed({
    shopName: shopName(),
    shopUrl: localizedUrl(locale, ''),
    products
  });

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900'
    }
  });
}
EOF

# 9e) noindex layouts for the pages that must stay out of search. A layout
# rather than per-page metadata because some of these pages are client
# components, which cannot export metadata.
for section in cart checkout account auth; do
  mkdir -p "src/app/[locale]/$section"
  cat > "src/app/[locale]/$section/layout.tsx" <<'EOF'
import type { ReactNode } from 'react';
import type { Metadata } from 'next';

import { NOINDEX } from '@/lib/seo/alternates';

/** Private or transactional pages: never indexed, no hreflang set. */
export const metadata: Metadata = NOINDEX;

export default function NoIndexLayout({ children }: { children: ReactNode }) {
  return children;
}
EOF
done

# 10) Minimal shop/cart/checkout pages; checkout protected server-side
mkdir -p src/app/[locale]/shop/[slug] src/app/[locale]/cart src/app/[locale]/checkout
cat > src/app/[locale]/shop/page.tsx <<'EOF'
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import JsonLd from '@/components/seo/JsonLd';
import ShopArchive from '@/components/store/ShopArchive';
import { localizedUrl, pageAlternates } from '@/lib/seo/alternates';
import { breadcrumbJsonLd } from '@/lib/seo/jsonld';

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Shop' });
  return { title: t('title'), alternates: pageAlternates(locale, '/shop') };
}

export default async function ShopPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Shop' });
  const tNav = await getTranslations({ locale, namespace: 'Nav' });

  return (
    <main className="mx-auto max-w-7xl p-6">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: tNav('Home'), url: localizedUrl(locale, '') },
          { name: t('title') }
        ])}
      />
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      {/* Search, filters, sorting and the grid; state in the URL. The
          mode-specific fetching lives in ShopArchive. */}
      <ShopArchive locale={locale} searchParams={await searchParams} />
    </main>
  );
}
EOF
# The product page is one file for both store modes; the mode-specific
# part (heat, chilli types) is ProductExtras in src/components/store.
cat > src/app/[locale]/shop/[slug]/page.tsx <<'EOF'
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getTranslations } from 'next-intl/server';

import AddToCartButton from '@/components/cart/AddToCartButton';
import JsonLd from '@/components/seo/JsonLd';
import ProductExtras from '@/components/store/ProductExtras';
import ProductGallery from '@/components/store/ProductGallery';
import { Badge } from '@/components/ui/badge';
import { formatPrice } from '@/lib/format';
import { hreflangOf } from '@/lib/i18n/locales';
import { localizedUrl, pageAlternates } from '@/lib/seo/alternates';
import { availabilityFor, breadcrumbJsonLd, productJsonLd } from '@/lib/seo/jsonld';
import { returnPolicy, shippingPolicy, shopName } from '@/lib/seo/store';
import { CHECKOUT_CONFIG } from '@/lib/checkout/config';
import {
  cleanList,
  formatDimensions,
  formatMeasure,
  formatWeight,
  galleryImages,
  hasSaving,
  nutritionRows,
  quantityLimit,
  stockRulesOf,
  stockStatus,
  type ProductDetailRow
} from '@/lib/products/detail';
import { createClient } from '@/lib/supabase/server';

type Params = Promise<{ locale: string; slug: string }>;

// products_public is the storefront view: published, unarchived rows with
// no supplier fields, so selecting everything is safe. Its columns also
// differ by store mode (heat_level only exists in chilli shops), which is
// the other reason not to list them. cache() shares the row between
// generateMetadata and the page within one request.
const loadProduct = cache(async (slug: string): Promise<ProductDetailRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('products_public')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  return (data as ProductDetailRow | null) ?? null;
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = await loadProduct(slug);
  if (!product) return {};
  const description =
    product.meta_description ?? product.headline ?? product.description ?? undefined;
  const images = galleryImages(product.image_url, product.gallery_urls);
  return {
    title: product.meta_title ?? product.name,
    description,
    // Self-referencing canonical plus the full hreflang set, x-default
    // included, built by the same helper as the sitemap.
    alternates: pageAlternates(locale, `/shop/${product.slug}`),
    openGraph: {
      type: 'website',
      siteName: shopName(),
      locale: hreflangOf(locale),
      url: localizedUrl(locale, `/shop/${product.slug}`),
      title: product.meta_title ?? product.name,
      description,
      images: images.map((url) => ({ url }))
    }
  };
}

const SECTION_HEADING = 'text-sm font-semibold uppercase tracking-wide text-gray-500';

export default async function ProductPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  const product = await loadProduct(slug);
  if (!product) notFound();

  const t = await getTranslations({ locale, namespace: 'Product' });
  const tNav = await getTranslations({ locale, namespace: 'Nav' });

  const rules = stockRulesOf(product);
  const status = stockStatus(rules);
  const soldOut = status.kind === 'sold_out';
  const images = galleryImages(product.image_url, product.gallery_urls);
  const pageUrl = localizedUrl(locale, `/shop/${product.slug}`);

  // Home > Shop > Category > Product, visible and as BreadcrumbList.
  const crumbs = [
    { name: tNav('Home'), url: localizedUrl(locale, '') },
    { name: tNav('Shop'), url: localizedUrl(locale, '/shop') },
    ...(product.category_name && product.category_slug
      ? [{ name: product.category_name, url: localizedUrl(locale, `/shop?category=${encodeURIComponent(product.category_slug)}`) }]
      : []),
    { name: product.name }
  ];
  const structuredData = [
    breadcrumbJsonLd(crumbs),
    productJsonLd({
      url: pageUrl,
      name: product.name,
      description: product.meta_description ?? product.description ?? product.details,
      images,
      sku: product.sku,
      barcode: product.barcode,
      brand: product.brand_name,
      category: product.category_name,
      priceCents: product.price_cents,
      currency: product.currency,
      availability: availabilityFor(status.kind),
      shipping: shippingPolicy(product.currency),
      returnPolicy: returnPolicy(CHECKOUT_CONFIG.allowedCountries[0]),
      sellerName: shopName()
    })
  ];
  const tags = cleanList(product.tags);
  const nutrition = nutritionRows(product.nutrition_info, locale);
  const wasPrice = hasSaving(product.price_cents, product.compare_at_price_cents)
    ? formatPrice(product.compare_at_price_cents as number, product.currency, locale)
    : null;

  // The short description is the lead when there is long copy as well;
  // otherwise it is the body on its own.
  const lead = product.details ? product.description : null;
  const body = product.details ?? product.description;

  const unit =
    product.net_content_unit === 'pieces' ? t('units.pieces') : product.net_content_unit;
  const facts: { label: string; value: string }[] = [];
  const addFact = (label: string, value: string | null | undefined) => {
    if (value) facts.push({ label, value });
  };
  addFact(t('netContent'), formatMeasure(product.net_content, unit, locale));
  addFact(t('weight'), formatWeight(product.weight_grams, locale));
  addFact(t('dimensions'), formatDimensions(product.dimensions_mm, locale));
  addFact(t('countryOfOrigin'), product.country_of_origin);
  addFact(t('allergens'), cleanList(product.allergens).join(', '));
  addFact(
    t('dietary'),
    cleanList(product.dietary_flags)
      .map((flag) => (t.has(`dietaryFlags.${flag}`) ? t(`dietaryFlags.${flag}`) : flag))
      .join(', ')
  );
  addFact(t('bestBefore'), product.best_before_text);

  const stockLine = (() => {
    switch (status.kind) {
      case 'low_stock':
        return { text: t('lowStock', { count: status.remaining }), tone: 'text-amber-700' };
      case 'backorder':
        return { text: t('backorder'), tone: 'text-amber-700' };
      case 'sold_out':
        return { text: t('soldOut'), tone: 'text-red-700' };
      default:
        return { text: t('inStock'), tone: 'text-green-700' };
    }
  })();

  return (
    <main className="mx-auto max-w-6xl p-6">
      <JsonLd data={structuredData} />
      <nav aria-label={t('backToShop')} className="mb-6 text-sm text-gray-600">
        <ol className="flex flex-wrap items-center gap-1">
          {crumbs.map((crumb, index) => (
            <li key={`${crumb.name}-${index}`} className="flex items-center gap-1">
              {index > 0 && <span aria-hidden="true">/</span>}
              {crumb.url ? (
                <Link href={crumb.url} className="underline hover:text-gray-900">
                  {crumb.name}
                </Link>
              ) : (
                <span aria-current="page" className="text-gray-900">
                  {crumb.name}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        <ProductGallery images={images} name={product.name} />

        <div className="space-y-8">
          <header className="space-y-3">
            {(product.category_name || product.brand_name) && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                {product.category_name && (
                  <Badge variant="secondary" className="font-normal">
                    <span className="sr-only">{t('category')}: </span>
                    {product.category_name}
                  </Badge>
                )}
                {product.brand_name && (
                  <span>
                    <span className="sr-only">{t('brand')}: </span>
                    {product.brand_name}
                  </span>
                )}
              </div>
            )}
            <h1 className="text-3xl font-bold">{product.name}</h1>
            {product.headline && <p className="text-lg text-gray-700">{product.headline}</p>}
          </header>

          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-2xl font-bold">
                {formatPrice(product.price_cents, product.currency, locale)}
              </span>
              {wasPrice && (
                <>
                  <span className="sr-only">{t('wasPrice', { price: wasPrice })}</span>
                  <s aria-hidden="true" className="text-base text-gray-500">
                    {wasPrice}
                  </s>
                </>
              )}
              <span className={`text-sm font-medium ${stockLine.tone}`}>{stockLine.text}</span>
            </div>

            <AddToCartButton
              locale={locale}
              productId={product.id}
              sizeOptions={product.size_options}
              colorOptions={product.color_options}
              soldOut={soldOut}
              withQuantity
              maxQuantity={quantityLimit(rules)}
              className="w-full sm:w-auto sm:min-w-48"
            />
          </div>

          <ProductExtras
            locale={locale}
            productId={product.id}
            heatLevel={product.heat_level ?? null}
            scovilleShu={product.scoville_shu ?? null}
          />

          {body && (
            <section aria-labelledby="product-about" className="space-y-2">
              <h2 id="product-about" className={SECTION_HEADING}>
                {t('about')}
              </h2>
              {lead && lead !== body && <p className="font-medium text-gray-800">{lead}</p>}
              <div className="whitespace-pre-line text-gray-800">{body}</div>
            </section>
          )}

          {product.ingredients && (
            <section aria-labelledby="product-ingredients" className="space-y-2">
              <h2 id="product-ingredients" className={SECTION_HEADING}>
                {t('ingredients')}
              </h2>
              <p className="whitespace-pre-line text-gray-800">{product.ingredients}</p>
            </section>
          )}

          {facts.length > 0 && (
            <section aria-labelledby="product-facts" className="space-y-2">
              <h2 id="product-facts" className={SECTION_HEADING}>
                {t('facts')}
              </h2>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
                {facts.map((fact) => (
                  <div key={fact.label} className="contents">
                    <dt className="text-gray-500">{fact.label}</dt>
                    <dd className="text-gray-800">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {nutrition.length > 0 && (
            <section aria-labelledby="product-nutrition" className="space-y-2">
              <h2 id="product-nutrition" className={SECTION_HEADING}>
                {t('nutritionTitle')}
              </h2>
              <table className="w-full max-w-md text-sm">
                <tbody className="divide-y divide-gray-200">
                  {nutrition.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className="py-1 text-start font-normal text-gray-500">
                        {t(`nutrition.${row.key}`)}
                      </th>
                      <td className="py-1 text-end text-gray-800">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {product.storage_instructions && (
            <section aria-labelledby="product-storage" className="space-y-2">
              <h2 id="product-storage" className={SECTION_HEADING}>
                {t('storage')}
              </h2>
              <p className="whitespace-pre-line text-gray-800">{product.storage_instructions}</p>
            </section>
          )}

          {tags.length > 0 && (
            <section aria-labelledby="product-tags" className="space-y-2">
              <h2 id="product-tags" className={SECTION_HEADING}>
                {t('tags')}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <li key={tag}>
                    <Badge variant="outline" className="font-normal">
                      {tag}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
EOF
cat > src/app/[locale]/cart/page.tsx <<'EOF'
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import CartLines from '@/components/cart/CartLines';
import DiscountCodeForm from '@/components/cart/DiscountCodeForm';
import { getCart } from '@/lib/cart/service';
import { resolveCartDiscount } from '@/lib/discounts/service';
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
  // The applied promo code, re-checked against the cart as it is now.
  const promo = await resolveCartDiscount({
    subtotalCents: cart.totals.subtotalCents,
    currency: cart.currency
  });
  const money = (cents: number) => formatPrice(cents, cart.currency, locale);

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

      <div className="mt-6 border-t border-gray-200 pt-4">
        <DiscountCodeForm
          locale={locale}
          appliedCode={promo.appliedCode}
          problem={promo.check && !promo.check.ok ? promo.check : null}
          currency={cart.currency}
        />
      </div>

      <dl className="mt-4 space-y-1 border-t border-gray-200 pt-4 text-sm">
        <div className="flex items-center justify-between">
          <dt className="font-semibold">{t('subtotal')}</dt>
          <dd>{money(cart.totals.subtotalCents)}</dd>
        </div>
        {promo.outcome.discountCents > 0 && promo.discount && (
          <div className="flex items-center justify-between text-emerald-700">
            <dt>{t('discount.line', { code: promo.discount.code })}</dt>
            <dd>−{money(promo.outcome.discountCents)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between">
          <dt className="text-gray-600">{t('discount.shipping')}</dt>
          <dd>
            {promo.outcome.shippingDiscountCents > 0 && promo.discount ? (
              <span className="text-emerald-700">
                {t('discount.freeShipping', { code: promo.discount.code })}
              </span>
            ) : (
              money(promo.outcome.shippingCents)
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between border-t border-gray-200 pt-2">
          <dt className="text-lg font-semibold">{t('discount.total')}</dt>
          <dd className="text-lg font-bold">{money(promo.outcome.totalCents)}</dd>
        </div>
      </dl>
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/auth/sign-in`);

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
              <Link href={`/${locale}/account/orders`} className="text-gray-600 hover:text-gray-900">
                Orders
              </Link>
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

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams, useSearchParams } from 'next/navigation';

import { supabase } from '@/lib/supabase/client';
import { mergeGuestCartAction } from '@/lib/cart/actions';
import { AUTH_CONFIG } from '@/lib/auth/config';
import OtpSignIn from '@/components/auth/OtpSignIn';

// useSearchParams needs a Suspense boundary so the page can be prerendered.
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignIn />
    </Suspense>
  );
}

function SignIn() {
  const { locale } = useParams() as { locale: string };
  const searchParams = useSearchParams();
  // The shop owner always has a password, so even an email-code shop keeps
  // the password form reachable at ?method=password.
  const usePassword =
    AUTH_CONFIG.customerSignIn === 'password' || searchParams.get('method') === 'password';

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold mb-4">Sign in</h1>
      {usePassword ? <PasswordSignIn locale={locale} /> : <OtpSignIn locale={locale} />}
      {AUTH_CONFIG.customerSignIn === 'otp' && (
        <p className="mt-4 text-center text-sm text-gray-500">
          {usePassword ? (
            <Link href={`/${locale}/auth/sign-in`} className="underline">
              Sign in with an email code instead
            </Link>
          ) : (
            <Link href={`/${locale}/auth/sign-in?method=password`} className="underline">
              Shop owner? Sign in with your password
            </Link>
          )}
        </p>
      )}
    </main>
  );
}

function PasswordSignIn({ locale }: { locale: string }) {
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
    <form onSubmit={onSubmit} className="space-y-3">
      <input className="w-full border p-2 rounded" placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/>
      <input className="w-full border p-2 rounded" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required/>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      <button className="w-full rounded bg-black text-white p-2">Sign in</button>
    </form>
  );
}
EOF

cat > src/app/[locale]/auth/sign-up/page.tsx <<'EOF'
'use client';

import { Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { AUTH_CONFIG } from '@/lib/auth/config';
import OtpSignIn from '@/components/auth/OtpSignIn';

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
  const { locale } = useParams() as { locale: string };
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

  // With email codes there is no separate sign-up: the first code creates
  // the account and confirms the address in one step.
  if (AUTH_CONFIG.customerSignIn === 'otp') {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="text-2xl font-bold mb-4">Create account</h1>
        <OtpSignIn locale={locale} initialEmail={email} next={next} />
      </main>
    );
  }

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

mkdir -p src/app/[locale]/auth/mfa
cat > src/app/[locale]/auth/mfa/page.tsx <<'EOF'
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { supabase } from '@/lib/supabase/client';

/**
 * Second factor for the shop owner: a six-digit code from an authenticator
 * app. The admin guard sends the owner here when their session is not yet
 * at AAL2. First visit enrols (shows a QR code), later visits verify.
 */
type Stage =
  | { kind: 'loading' }
  | { kind: 'enrol'; factorId: string; qrCode: string; secret: string }
  | { kind: 'verify'; factorId: string }
  | { kind: 'error'; message: string };

export default function MfaPage() {
  const { locale } = useParams() as { locale: string };
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function prepare() {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace(`/${locale}/auth/sign-in?method=password`);
        return;
      }

      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) {
        if (!cancelled) setStage({ kind: 'error', message: listError.message });
        return;
      }

      const verified = factors.totp.find((factor) => factor.status === 'verified');
      if (verified) {
        if (!cancelled) setStage({ kind: 'verify', factorId: verified.id });
        return;
      }

      // An abandoned enrolment leaves an unverified factor behind, and a
      // second enrol with the same name is refused, so clear it first.
      for (const factor of factors.totp.filter((f) => f.status !== 'verified')) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }

      const { data: enrolment, error: enrolError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Shop admin'
      });
      if (enrolError || !enrolment) {
        if (!cancelled) {
          setStage({ kind: 'error', message: enrolError?.message ?? 'Could not start enrolment' });
        }
        return;
      }
      if (!cancelled) {
        setStage({
          kind: 'enrol',
          factorId: enrolment.id,
          qrCode: enrolment.totp.qr_code,
          secret: enrolment.totp.secret
        });
      }
    }

    void prepare();
    return () => {
      cancelled = true;
    };
  }, [locale, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (stage.kind !== 'enrol' && stage.kind !== 'verify') return;
    setErr(null);
    setBusy(true);

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: stage.factorId
    });
    if (challengeError || !challenge) {
      setBusy(false);
      setErr(challengeError?.message ?? 'Could not start verification');
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: stage.factorId,
      challengeId: challenge.id,
      code: code.trim()
    });
    if (verifyError) {
      setBusy(false);
      setErr(verifyError.message);
      return;
    }

    router.push(`/${locale}/admin`);
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold mb-4">Two-factor authentication</h1>

      {stage.kind === 'loading' && <p className="text-gray-600">Preparing…</p>}

      {stage.kind === 'error' && <p className="text-red-600 text-sm">{stage.message}</p>}

      {stage.kind === 'enrol' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Scan this code with your authenticator app (Google Authenticator, Authy,
            1Password…), then enter the six-digit code it shows.
          </p>
          {/* Supabase returns the QR code as an inline SVG data URL, which
              next/image cannot optimise, so a plain img is the right tag. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={stage.qrCode} alt="Authenticator QR code" className="mx-auto h-48 w-48" />
          <p className="text-xs text-gray-500 break-all">
            Can&apos;t scan? Enter this key by hand: <code>{stage.secret}</code>
          </p>
        </div>
      )}

      {stage.kind === 'verify' && (
        <p className="text-sm text-gray-600">Enter the code from your authenticator app.</p>
      )}

      {(stage.kind === 'enrol' || stage.kind === 'verify') && (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            className="w-full border p-2 rounded tracking-widest"
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          {err && <p className="text-red-600 text-sm">{err}</p>}
          <button className="w-full rounded bg-black text-white p-2" disabled={busy}>
            {busy ? 'Checking…' : stage.kind === 'enrol' ? 'Activate' : 'Continue'}
          </button>
        </form>
      )}
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
# Email is optional: with no key the shop sends nothing and works as before.
ensure_env_default "RESEND_API_KEY" ""
ensure_env_default "EMAIL_FROM" ""
ensure_env_default "EMAIL_REPLY_TO" ""
ensure_env_default "SHOP_OWNER_EMAIL" ""
ensure_env_default "NEXT_PUBLIC_SHOP_NAME" "$APP_NAME"
# Working files of the email tools (send logs, rendered previews) go in one
# /tmp/sf-<tag>-email-builder directory and nowhere else, so two checkouts
# or two shops on one machine never share them. The tag is
# SHOPFORGE_TMP_TAG if set, else the last part of the shopforge branch
# (feat/email-builder -> email-builder), else the shop's name.
email_tmp_tag() {
  local tag="${SHOPFORGE_TMP_TAG:-}"
  if [ -z "$tag" ]; then
    local branch
    branch=$(git -C "$SCRIPT_DIR" branch --show-current 2>/dev/null || true)
    case "$branch" in
      ""|main|master) tag="$APP_NAME" ;;
      *) tag="${branch##*/}" ;;
    esac
  fi
  tag=$(echo "$tag" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
  echo "${tag:-shop}"
}
# An exported EMAIL_TMP_DIR wins (the test script sets it with --tmp-dir).
ensure_env_default "EMAIL_TMP_DIR" "${EMAIL_TMP_DIR:-/tmp/sf-$(email_tmp_tag)-email-builder}"
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
echo "  cd $APP_PATH"
echo "  pnpm dev"
echo "  Open http://localhost:3000/$DEFAULT_LOCALE/auth/sign-up and create your account (with a password)."
echo "  Then promote it in the Supabase SQL editor:"
echo "    update public.profiles set role = 'shop_owner' where id = (select id from auth.users where email = 'you@example.com');"
if [ "$SHOPFORGE_ADMIN_MFA" = "required" ]; then
  echo "  Your first visit to /admin asks you to set up an authenticator app."
fi
if [ "$SHOPFORGE_CUSTOMER_AUTH" = "otp" ]; then
  echo "  Customers sign in with an email code: in Supabase, edit the Magic Link email template"
  echo "  to use {{ .Token }} instead of {{ .ConfirmationURL }}, or they will get a link."
fi
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
