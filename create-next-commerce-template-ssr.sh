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
LOCALES_CSV=${3:-"en,de"}  # comma-separated

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
# Pages and routes that are plain files rather than generated here (the
# newsletter confirm and unsubscribe pages, the one-click endpoint, and
# every admin page that is the same in all store modes, under
# [locale]/admin). The mode's own admin files are copied on top later
# (10.6), so a mode can still replace any of them.
mkdir -p src/app
cp -R "$SHARED_DIR/app/." src/app/

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
 * Authentication configuration: what this shop starts with.
 *
 * Written by create-next-commerce-template-ssr.sh from the answers given at
 * generation time. This is the fallback, not the live setting: the
 * "Sign-in and security" section of /admin/settings writes a store_settings
 * row, and from the moment the owner saves it that row decides
 * (src/lib/settings/). Editing this file changes a shop that has never
 * saved those settings.
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

# 1. Schema, as a numbered series (see lib/migrations/README.md). 0001_init is
# the mode's own base schema; 0002+ are the feature migrations every mode
# shares. A mode may override a shared file by shipping the same name, so the
# mode's directory is copied second. Numbers 0001-0099 are the schema; the
# seeds and policies below take 0100+, so a schema migration added later can
# never collide with a number a live shop has already applied.
for migration in "$SCRIPT_DIR"/lib/migrations/[0-9]*.sql; do
  cp "$migration" "supabase/migrations/$(basename "$migration")"
done
for migration in "$MODE_DIR"/migrations/[0-9]*.sql; do
  cp "$migration" "supabase/migrations/$(basename "$migration")"
done

# 2. Seed Data
if [ -f "$MODE_DIR/seeds.sql" ]; then
  cp "$MODE_DIR/seeds.sql" supabase/migrations/0100_seeds.sql
  # Seed heat values are written on a 0-10 basis as __HEAT_n__ and rescaled
  # to whatever heat scale this shop chose.
  HEAT_MAX="${SHOPFORGE_HEAT_MAX:-10}" python3 <<'PYSEED'
import os, pathlib, re
path = pathlib.Path('supabase/migrations/0100_seeds.sql')
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
  cp "$MODE_DIR/brand-single.sql" supabase/migrations/0101_brand_single.sql
fi

# Storage policies (public read, owner-only writes) are 0102 and come from
# lib/migrations/ with the rest; test/check-schema.sh applies them from there.

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
    "email": "Email",
    "password": "Password",
    "confirmPassword": "Confirm password",
    "code": "Six-digit code",
    "checking": "Checking…",
    "sending": "Sending…",
    "saving": "Saving…",
    "signIn": {
      "title": "Sign in",
      "submit": "Sign in",
      "forgot": "Forgot your password?",
      "noAccount": "New here? Create an account",
      "useCode": "Sign in with an email code instead",
      "ownerPassword": "Shop owner? Sign in with your password",
      "confirmationFailed": "That link did not work. It may have expired or been used already: sign in, or ask for a new one."
    },
    "signUp": {
      "title": "Create account",
      "submit": "Create account",
      "haveAccount": "Already have an account? Sign in",
      "checkEmailTitle": "Check your email",
      "checkEmail": "We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account."
    },
    "otp": {
      "send": "Email me a code",
      "sent": "We sent a six-digit code to <strong>{email}</strong>. Enter it below.",
      "restart": "Use a different email or resend the code"
    },
    "mfa": {
      "title": "Two-factor authentication",
      "preparing": "Preparing…",
      "enrolHint": "Scan this code with your authenticator app (Google Authenticator, Authy, 1Password…), then enter the six-digit code it shows.",
      "qrAlt": "QR code for your authenticator app",
      "manualKey": "Can’t scan? Enter this key by hand:",
      "verifyHint": "Enter the code from your authenticator app.",
      "activate": "Activate",
      "continue": "Continue"
    },
    "reset": {
      "title": "Reset password",
      "hint": "Enter the email address of your account and we will send you a link to choose a new password.",
      "submit": "Send reset link",
      "sent": "If an account exists for that address, a link to choose a new password is on its way.",
      "backToSignIn": "Back to sign in"
    },
    "update": {
      "title": "Choose a new password",
      "submit": "Save new password",
      "done": "Your password has been changed.",
      "continue": "Continue shopping",
      "noSession": "This link has expired or has already been used.",
      "requestNew": "Ask for a new one"
    },
    "errors": {
      "passwordsDiffer": "The passwords do not match.",
      "invalidCredentials": "That email and password do not match an account.",
      "emailNotConfirmed": "Confirm your email address first: the link is in the email we sent you.",
      "rateLimited": "Too many attempts. Wait a minute and try again.",
      "codeInvalid": "That code is wrong or has expired.",
      "userExists": "An account with this email already exists. Sign in instead.",
      "weakPassword": "Choose a longer or less common password.",
      "samePassword": "The new password must be different from the old one.",
      "generic": "Something went wrong. Please try again."
    }
  },
  "Nav": {
    "Shop": "Shop",
    "Cart": "Cart",
    "Checkout": "Checkout",
    "Account": "Account",
    "Home": "Home",
    "admin": "Admin",
    "orders": "Orders",
    "signIn": "Sign in",
    "signUp": "Sign up",
    "signOut": "Sign out"
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
      "refunded": "Refunded",
      "disputed": "Disputed"
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
    "settings": {
      "heading": "Settings",
      "subheading": "How your shop presents itself. Changes show on the next page load.",
      "shop": {
        "heading": "Shop",
        "hint": "The basics customers see on every page and in every email.",
        "name": "Shop name",
        "nameHint": "In the header, page titles, search results and emails.",
        "nameFromDefault": "Not saved yet: this is the name the shop was set up with. Save to make it yours.",
        "logo": "Logo",
        "logoHint": "Shown in the header instead of the name, in search results, and on emails unless the email brand has its own.",
        "modeHeading": "What you sell",
        "mode_generic": "Ordinary products",
        "mode_generic_hint": "Name, price, photos and the product fields you tick below.",
        "mode_chilli": "Chillies and hot sauce",
        "mode_chilli_hint": "Adds heat, Scoville and chilli types to products. Switching back hides them again; nothing you have entered is deleted.",
        "currency": "Currency",
        "currencyHint": "Every price in the shop is in this currency. Changing it never converts a price: each number keeps its value and gets the new label, so everything priced must be brought over first.",
        "conflictProducts": "{count, plural, one {This product is} other {These products are}} priced in a different currency — open each and save it with its new price:",
        "conflictDiscounts": "{count, plural, one {This discount code is} other {These discount codes are}} in a different currency — recreate {count, plural, one {it} other {them}} under Discounts:",
        "conflictMore": "…and {count} more.",
        "brandsHeading": "Brands",
        "brands_single": "Only my own products",
        "brands_single_hint": "A brand is optional on products. If your shop has none yet, one named after the shop is created for you.",
        "brands_multi": "Products from several brands",
        "brands_multi_hint": "Every product needs a brand. Products saved before the switch keep theirs.",
        "save": "Save",
        "saving": "Saving…",
        "savedNotice": "Saved. The changes are live.",
        "errors": {
          "not_authorized": "You are not allowed to do that.",
          "mfa_required": "Enter your authenticator code first, then try again.",
          "currency_conflict": "Not saved: some prices are still in a different currency.",
          "invalid": "Enter a name of up to 80 characters.",
          "failed": "The settings could not be saved.",
          "rescale_failed": "The scale was saved, but your products still carry their old numbers. Try saving again."
        }
      },
      "checkout": {
        "heading": "Checkout",
        "hint": "Who asks the customer for their delivery address, and where you deliver.",
        "addressHeading": "Delivery address",
        "address_form": "Ask on your checkout page",
        "address_form_hint": "The customer fills in their address in your shop, before paying.",
        "address_stripe": "Ask on Stripe's payment page",
        "address_stripe_hint": "Stripe collects the address while it takes the payment.",
        "countries": "Deliver to",
        "countriesHint": "The countries checkout offers. Pick at least one.",
        "countriesFromDefault": "Not saved yet: this is the list the shop was set up with. Save to make it yours.",
        "search": "Search countries",
        "selected": "{count, plural, one {# country} other {# countries}} selected",
        "save": "Save",
        "saving": "Saving…",
        "savedNotice": "Saved. Checkout follows the new settings.",
        "errors": {
          "not_authorized": "You are not allowed to do that.",
          "mfa_required": "Enter your authenticator code first, then try again.",
          "invalid": "Pick at least one country you deliver to.",
          "failed": "The settings could not be saved.",
          "rescale_failed": "The scale was saved, but your products still carry their old numbers. Try saving again."
        }
      },
      "shipping": {
        "heading": "Shipping",
        "hint": "What an order costs to ship, and where you ship from.",
        "fromDefault": "Not saved yet: these are the placeholder rates the shop was set up with. Save to make them yours.",
        "flatRate": "Flat rate per order ({currency})",
        "flatRateHint": "Charged on every order below the free-shipping threshold.",
        "freeShippingThreshold": "Free shipping from ({currency})",
        "freeShippingThresholdHint": "Orders at or above this amount ship free. Leave empty to never ship free.",
        "label": "Name at checkout",
        "labelHint": "Shown next to the shipping cost, on Stripe's page too.",
        "itemWeight": "Weight per item (g)",
        "itemWeightHint": "Used to estimate the parcel weight passed to Stripe.",
        "boxWeight": "Empty box weight (g)",
        "boxWeightHint": "Added once per order.",
        "homeCountry": "Ships from",
        "homeCountryHint": "The country your return policy names. The returns address will use it too.",
        "homeCountryUnset": "Not set — the first country you deliver to",
        "save": "Save",
        "saving": "Saving…",
        "savedNotice": "Saved. New orders use the new rates.",
        "errors": {
          "not_authorized": "You are not allowed to do that.",
          "mfa_required": "Enter your authenticator code first, then try again.",
          "invalid": "Check the amounts and weights, then try again.",
          "failed": "The settings could not be saved.",
          "rescale_failed": "The scale was saved, but your products still carry their old numbers. Try saving again."
        }
      },
      "auth": {
        "heading": "Sign-in and security",
        "hint": "How customers sign in, and how you get into the admin.",
        "fromDefault": "Not saved yet: this is how the shop was set up. Save to make it yours.",
        "customerHeading": "Customer sign-in",
        "customer_password": "Email and password",
        "customer_password_hint": "Customers choose a password and can reset it by email.",
        "customer_otp": "Email and a six-digit code",
        "customer_otp_hint": "No passwords for customers: each sign-in sends a code. You keep yours for the admin.",
        "mfaHeading": "Your second factor",
        "mfa_required": "Password and an authenticator code",
        "mfa_required_hint": "The admin asks for a code from your authenticator app on every new session.",
        "mfa_off": "Password only",
        "mfa_off_hint": "Faster to get in, and only as safe as your password.",
        "mfaOffWarning": "Saving this removes the authenticator app from your account, and your password alone will open the admin.",
        "save": "Save",
        "saving": "Saving…",
        "savedNotice": "Saved. Sign-in follows the new settings.",
        "errors": {
          "not_authorized": "You are not allowed to do that.",
          "mfa_required": "Enter your authenticator code first, then try again.",
          "invalid": "Pick one option in each group.",
          "failed": "The settings could not be saved.",
          "rescale_failed": "The scale was saved, but your products still carry their old numbers. Try saving again."
        }
      },
      "productFields": {
        "heading": "Product fields",
        "hint": "What the product form asks for. Every field is already in the database, so switching one on needs nothing else.",
        "fromDefault": "Not saved yet: these are the fields the shop was set up with. Save to make them yours.",
        "selected": "{count, plural, =0 {No fields} one {# field} other {# fields}} selected",
        "switchingOff": "Switching a field off hides it from the form and the shop. Nothing already saved is deleted, and switching it back on brings it into view again.",
        "save": "Save",
        "saving": "Saving…",
        "savedNotice": "Saved. The product form follows the new settings.",
        "errors": {
          "not_authorized": "You are not allowed to do that.",
          "mfa_required": "Enter your authenticator code first, then try again.",
          "invalid": "Those fields could not be saved.",
          "failed": "The settings could not be saved.",
          "rescale_failed": "The scale was saved, but your products still carry their old numbers. Try saving again."
        }
      },
      "heat": {
        "heading": "Heat",
        "hint": "How hot your products are, and how that reads in the shop.",
        "fromDefault": "Not saved yet: this is the scale the shop was set up with. Save to make it yours.",
        "max": "Top of the scale",
        "maxHint": "Heat runs from 0 to this number. Ten is a good default; twenty suits a shop that wants finer steps.",
        "rescaleWarning": "Saving moves every product from the {from}-point scale to the {to}-point one, keeping each one in proportion. Nothing is lost, but the numbers on your products will change.",
        "displayHeading": "How heat reads",
        "display_number": "The number",
        "display_word": "The word",
        "display_both": "Word and number",
        "display_peppers": "Chilli icons",
        "displayEmpty": "Nothing, until a product has heat",
        "bandsHeading": "Words",
        "bandsHint": "Each word covers everything up to its number, so the first one a product fits inside is the word it gets.",
        "bandsEmpty": "No words: heat shows as a number only.",
        "bandWord": "Word",
        "bandUpTo": "Up to",
        "bandAdd": "Add a word",
        "bandRemove": "Remove",
        "save": "Save",
        "saving": "Saving…",
        "savedNotice": "Saved. The shop follows the new scale.",
        "errors": {
          "not_authorized": "You are not allowed to do that.",
          "mfa_required": "Enter your authenticator code first, then try again.",
          "invalid": "Check the scale and the words, then try again.",
          "failed": "The settings could not be saved.",
          "rescale_failed": "The scale was saved, but your products still carry their old numbers. Try saving again."
        }
      }
    },
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
      "email": "Email",
      "settings": "Settings"
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
    "dispute": {
      "heading": "Chargeback",
      "openNotice": "A customer has disputed this payment. Stripe has held {amount} back from your balance while the card issuer decides.",
      "wonNotice": "You won this dispute. {amount} has gone back to your balance.",
      "lostNotice": "This dispute was lost. {amount} did not come back, and the order stays marked as disputed.",
      "deadline": "Evidence is due by {date}.",
      "noDeadline": "Stripe did not give a deadline for this one.",
      "reason": "Reason: {reason}",
      "opened": "Opened {date}",
      "closed": "Closed {date}",
      "answerInStripe": "Answer the dispute from your Stripe dashboard.",
      "refundBlocked": "An order cannot be refunded while it is being disputed.",
      "statuses": {
        "warning_needs_response": "Early warning: a response is needed",
        "warning_under_review": "Early warning: under review",
        "warning_closed": "Early warning: closed",
        "needs_response": "Needs a response",
        "under_review": "Under review",
        "won": "Won",
        "lost": "Lost"
      }
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
      "amountIn": "Amount off ({currency})",
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
      "comingSoon": "Campaigns are sent from the Campaigns tab; a test from any template goes to one address.",
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
        "sampleNote": "Merge tags show a sample subscriber called {name}. The unsubscribe link opens the unsubscribe page as a preview."
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
      },
      "tabs": {
        "label": "Email",
        "templates": "Templates",
        "subscribers": "Subscribers",
        "campaigns": "Campaigns",
        "settings": "Settings"
      },
      "subscribers": {
        "heading": "Subscribers",
        "subheading": "Everyone who signed up for the newsletter, with when and how they agreed. Only confirmed subscribers will receive campaigns.",
        "disabled": {
          "email-not-configured": "Sign-up is switched off: email is not configured (RESEND_API_KEY and EMAIL_FROM), so no confirmation could be sent.",
          "no-signing-secret": "Sign-up is switched off: EMAIL_SIGNING_SECRET is missing or shorter than 32 characters.",
          "no-site-url": "Sign-up is switched off: NEXT_PUBLIC_SITE_URL is not set, so the links in emails would have nowhere to go."
        },
        "notices": {
          "unsubscribed": "Unsubscribed.",
          "deleted": "Deleted, with their history.",
          "resent": "Confirmation email sent again.",
          "not_authorized": "Only the shop owner can do that.",
          "not_found": "That subscriber no longer exists.",
          "not_pending": "Only people who have not confirmed yet can be sent the confirmation again.",
          "failed": "Something went wrong. Please try again.",
          "updated": "Saved.",
          "invalid": "That language is not one of the shop's."
        },
        "status": {
          "pending": "Waiting for confirmation",
          "subscribed": "Subscribed",
          "unsubscribed": "Unsubscribed"
        },
        "search": "Search by email",
        "searchButton": "Search",
        "exportAll": "Download all as CSV",
        "exportFiltered": "Download “{status}” as CSV",
        "noMatches": "Nobody matches.",
        "empty": "Nobody has signed up yet. The sign-up form is at the bottom of every page.",
        "columns": {
          "email": "Email",
          "language": "Language",
          "status": "Status",
          "source": "Signed up through",
          "dates": "When",
          "actions": "Actions"
        },
        "sources": {
          "footer": "Footer form",
          "checkout": "Checkout",
          "import": "Import",
          "admin": "Admin"
        },
        "signedUp": "Asked on {date}",
        "confirmedOn": "Confirmed on {date}",
        "unsubscribedOn": "Left on {date}",
        "consentShown": "What they agreed to",
        "resend": "Resend confirmation",
        "unsubscribe": "Unsubscribe",
        "confirmUnsubscribe": "Unsubscribe {email}? They can sign up again themselves.",
        "delete": "Delete",
        "confirmDelete": "Delete {email} and their history for good? Use this when someone asks to be forgotten.",
        "pagination": "Pages",
        "previous": "Previous",
        "next": "Next",
        "pageOf": "Page {page} of {pages}",
        "importHeading": "Import from another service",
        "importIntro": "A CSV with an email column, and optionally first name and language, such as an export from Mailchimp. People already on the list are left as they are, and nobody who unsubscribed is added back.",
        "importConsent": "These people agreed to receive email from this shop, and I can show it if asked.",
        "importing": "Importing…",
        "import": "Import",
        "importDone": "{added, plural, =0 {Nobody new to add.} one {# subscriber added.} other {# subscribers added.}}",
        "importSkipped": "Skipped: {existing} already on the list, {unsubscribed} unsubscribed, {duplicates} repeated, {invalid} not an email address.",
        "importBadLine": "Line {line}: {value}",
        "errors": {
          "notAuthorized": "Only the shop owner can import.",
          "noFile": "Choose a CSV file.",
          "tooLarge": "The file is too large: at most 10,000 people and 2 MB at a time.",
          "noConsent": "Tick the box to confirm these people agreed.",
          "empty": "The file has no addresses in it.",
          "failed": "The import stopped: {message}"
        },
        "importConsentRecord": "Imported on {date} by the owner of {shop}, who confirmed this person had agreed to receive email from the shop.",
        "edit": "Edit",
        "editName": "First name",
        "editLanguage": "Language",
        "editSave": "Save"
      },
      "campaigns": {
        "heading": "Campaigns",
        "subheading": "A template sent to everyone who confirmed a subscription, one broadcast per language, through Resend.",
        "notConfigured": "Sending needs RESEND_API_KEY and EMAIL_FROM in the shop's environment.",
        "newHeading": "New campaign",
        "noTemplates": "Create a template first, under Templates.",
        "name": "Name",
        "template": "Template",
        "creating": "Creating…",
        "create": "Create draft",
        "empty": "No campaigns yet.",
        "columns": {
          "name": "Name",
          "status": "Status",
          "recipients": "Recipients",
          "when": "When",
          "actions": "Actions"
        },
        "status": {
          "draft": "Draft",
          "scheduled": "Scheduled",
          "sending": "Sending",
          "sent": "Sent",
          "failed": "Failed"
        },
        "sentOn": "Sent {date}",
        "scheduledFor": "Scheduled for {date}",
        "createdOn": "Created {date}",
        "confirmDelete": "Delete the draft “{name}”?",
        "delete": "Delete",
        "notices": {
          "deleted": "Draft deleted."
        },
        "errors": {
          "not_authorized": "Only the shop owner can do that.",
          "not_found": "That campaign no longer exists.",
          "name": "Give the campaign a name of up to 120 characters.",
          "template": "Choose a template.",
          "template_invalid": "That template has problems; open it in the designer and save it first.",
          "not_draft": "Only drafts can be sent or deleted.",
          "schedule_invalid": "That is not a valid time.",
          "schedule_past": "Pick a time at least 5 minutes from now.",
          "schedule_too_far": "Pick a time within the next 30 days.",
          "not_configured": "Sending needs RESEND_API_KEY and EMAIL_FROM.",
          "nobody": "Nobody has confirmed a subscription yet.",
          "audience_missing": "The list for {message} has not been synced yet. Sync first.",
          "not_synced": "The list for {message} has changes that are not synced yet. Sync first.",
          "failed": "Something went wrong: {message}"
        },
        "back": "All campaigns",
        "progressHeading": "Progress",
        "refresh": "Refresh status",
        "recipientsTotal": "{count, plural, one {# recipient} other {# recipients}}",
        "recipientsCount": "{count, plural, one {# recipient} other {# recipients}}",
        "localeStatus": {
          "pending": "Preparing",
          "queued": "Sending",
          "scheduled": "Scheduled",
          "sent": "Sent",
          "failed": "Failed",
          "skipped": "Nobody in this language"
        },
        "cancelHint": "To cancel a scheduled campaign, cancel its broadcasts in the Resend dashboard, then refresh the status here.",
        "snapshotNote": "This is a copy of the template as it was when the campaign was created. Editing the template does not change it.",
        "sync": {
          "heading": "The list at Resend",
          "intro": "Before sending, everyone who confirmed is pushed to a Resend audience for their language, and people who unsubscribed through Resend are read back. Resend takes one person per request, so the first sync of a large list takes a while; leave this page open.",
          "running": "Syncing…",
          "syncNow": "Sync {count, plural, one {# change} other {# changes}}",
          "syncAgain": "Sync again",
          "language": "Language",
          "recipients": "Will receive it",
          "toSync": "To sync",
          "state": "State",
          "pushing": "Pushed {count} so far…",
          "error": "Stopped: {message}",
          "done": "Done: {pushed} pushed, {pulled} unsubscribed at Resend.",
          "nobody": "Nobody",
          "noAudience": "Not synced yet",
          "outOfDate": "Changes to sync",
          "upToDate": "Up to date"
        },
        "send": {
          "heading": "Send",
          "intro": "{count, plural, =0 {Nobody will receive this yet.} one {# person will receive it.} other {# people will receive it.}}",
          "now": "Send now",
          "later": "Schedule",
          "time": "Time",
          "timeHint": "In your time zone ({zone}); within the next 30 days.",
          "notReady": "Sync the list first, and make sure sending is configured.",
          "sending": "Sending…",
          "schedule": "Schedule",
          "sendNow": "Send now",
          "confirmNow": "Send this campaign to {count, plural, one {# person} other {# people}} now? This cannot be undone.",
          "confirmLater": "Schedule this campaign for {count, plural, one {# person} other {# people}} at {time}?"
        }
      },
      "settings": {
        "heading": "Email settings",
        "subheading": "Which provider sends this shop’s email, and the keys it uses.",
        "campaignProviderLabel": "Campaigns sent by",
        "transactionalLabel": "Receipts sent by",
        "transactionalNote": "Receipts, refund and shipping emails always go through Resend. Mailchimp has no transactional product behind this key, so the two are set separately — a shop can send its newsletter with Mailchimp and its receipts with Resend.",
        "providerNone": "Nobody — this shop cannot send email yet",
        "senderLabel": "Sender address",
        "senderMissing": "Not set",
        "senderRequired": "Set EMAIL_FROM to a sender you have verified with the provider. Without it nothing can be sent, even with a key in place.",
        "providers": {
          "resend": "Resend",
          "mailchimp": "Mailchimp"
        },
        "providerBlurbs": {
          "resend": "One audience per language, created for you. The simplest if you have no mailing list yet.",
          "mailchimp": "Your existing Mailchimp audience, with a tag per language. Choose this if your list already lives there."
        },
        "providerNeedsKey": "Add a key below before you can choose this one.",
        "activeBadge": "Sending campaigns",
        "choiceHeading": "Which provider sends campaigns",
        "choiceHint": "Only affects newsletters. Receipts are unaffected.",
        "choiceLocked": "EMAIL_CAMPAIGN_PROVIDER is set in this shop’s environment and decides this. Remove it to choose here.",
        "choose": "Use this provider",
        "choosing": "Switching…",
        "chosenNotice": "Campaigns will now be sent with {provider}. Sync each language again before your next campaign: the audiences at the new provider start empty.",
        "stored": "A key is stored. Added {date}.",
        "storedWithHint": "A key ending {hint} is stored. Added {date}.",
        "notStored": "No key is stored here yet.",
        "fromEnvironment": "{variable} is set in this shop’s environment, and that key is the one being used. A key stored here is kept but ignored until the environment variable is removed.",
        "keyLabel": "API key",
        "replaceLabel": "Replace the key",
        "keyPlaceholders": {
          "resend": "re_…",
          "mailchimp": "…-us21"
        },
        "keyHints": {
          "resend": "From your Resend dashboard, under API Keys. Sending access is enough.",
          "mailchimp": "From Mailchimp, under Account → Extras → API keys. It ends in your data centre, such as -us21."
        },
        "writeOnlyWarning": "The key is tested with the provider and only stored if it works. Once stored it is encrypted and cannot be shown again — not here, and not anywhere else in this admin. Keep your own copy with the provider; to change it, enter a new one.",
        "testing": "Testing…",
        "testAndSave": "Test and save",
        "savedNotice": "Saved. The key ending {hint} was accepted by the provider. It cannot be shown again — if you need a copy, take it from the provider.",
        "remove": "Remove this key",
        "removing": "Removing…",
        "removeHint": "Deletes the stored key. If it was the one sending campaigns, the other stored key takes over.",
        "removedNotice": "The stored key has been removed.",
        "mailchimpListNote": "Mailchimp sends to the audience your account already has, tagging each subscriber with their language (lang-en, lang-de, and so on). If your account has more than one audience, set MAILCHIMP_LIST_ID to the one you want.",
        "samples": {
          "heading": "Samples",
          "hint": "Each email for an imaginary order, in your language and the saved brand. Save first, then preview or send one to yourself.",
          "preview": "Preview",
          "send": "Email me this sample",
          "sending": "Sending…",
          "sentNotice": "Sent to {to}. Check your inbox (and spam).",
          "notConfigured": "Set up a sender and a key first.",
          "subjectPrefix": "[Sample] {subject}",
          "errors": {
            "not_authorized": "You are not allowed to do that.",
            "unknown_kind": "That is not an email this shop sends.",
            "no_address": "Your account has no email address to send to.",
            "not_configured": "This shop cannot send email yet: set EMAIL_FROM and a Resend key.",
            "failed": "The sample could not be sent."
          }
        },
        "brand": {
          "heading": "Brand",
          "hint": "The logo, colours, font and footer that the receipt, shipping and refund emails wear. New campaign templates start from them too.",
          "colours": {
            "brandColor": "Accent colour",
            "textColor": "Text colour",
            "backgroundColor": "Page background",
            "contentColor": "Card background"
          },
          "colourHints": {
            "brandColor": "Buttons and links. The button text is black or white, whichever reads better.",
            "textColor": "Headings and body text.",
            "backgroundColor": "Behind the email.",
            "contentColor": "Behind the text."
          },
          "font": "Font",
          "fonts": {
            "system": "System (the reader’s own)",
            "sans": "Helvetica / Arial",
            "serif": "Georgia / Times"
          },
          "logo": "Logo",
          "logoHint": "Shown at the top of every email, linked to your shop. Leave empty to use the shop logo from Settings, if one is set.",
          "logoWidth": "Logo width",
          "logoWidthHint": "Pixels, 40 to 300.",
          "footer": "Footer, per language",
          "footerHint": "Your business name and postal address, or a legal line. Shown in small print under every email, in the customer’s language where you have given one.",
          "save": "Save brand",
          "saving": "Saving…",
          "savedNotice": "Saved. Every receipt, shipping and refund email from now on uses this brand.",
          "previewHeading": "Preview",
          "previewHint": "A receipt for an imaginary order, in your language and the saved brand. Save to refresh it.",
          "sampleProductOne": "Sample product",
          "sampleProductTwo": "Another sample product",
          "sampleCustomer": "Jo Example",
          "sampleStreet": "1 Sample Street",
          "sampleRefundReason": "Bottle arrived cracked; sorry about that.",
          "copy": {
            "heading": "Wording",
            "hint": "Your own first paragraph and last line for each email, per language. Leave a box empty to keep the built-in wording shown in grey. The order details in between are always generated.",
            "kinds": {
              "confirmation": "Order confirmation",
              "shipping": "Shipping notification",
              "refund": "Refund notification"
            },
            "intro": "First paragraph",
            "footer": "Last line",
            "noIntro": "No first paragraph unless you write one.",
            "tagsHint": "Personal details you can use:",
            "fallbackName": "there"
          },
          "errors": {
            "not_authorized": "You are not allowed to do that.",
            "invalid": "Something here is not right. Colours are written #rrggbb and the logo must be an https:// address.",
            "failed": "The brand could not be saved."
          }
        },
        "errors": {
          "not_authorized": "You are not allowed to do that.",
          "unknown_provider": "That is not a provider this shop supports.",
          "empty": "Enter a key.",
          "too_short": "That is too short to be a provider key.",
          "rejected": "The provider refused that key. Check you copied all of it, and that it has not been revoked.",
          "unreachable": "The provider could not be reached, so the key was not tested and nothing was saved. Try again in a moment.",
          "no_vault": "Supabase Vault is not enabled on this project, so there is nowhere safe to keep the key. Enable it, or set the key in the environment instead.",
          "no_key": "Add that provider’s key before choosing it.",
          "failed": "The key could not be saved."
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
    "dispute": {
      "subject": {
        "opened": "{shop}: {amount} charged back on order {reference}",
        "won": "{shop}: you won the dispute on order {reference}",
        "lost": "{shop}: the dispute on order {reference} was lost"
      },
      "headline": {
        "opened": "A customer has disputed a payment",
        "won": "The dispute was resolved in your favour",
        "lost": "The dispute was lost"
      },
      "summary": {
        "opened": "{amount} on order {reference} has been charged back. Stripe has held the amount back from your balance while the card issuer decides.",
        "won": "The card issuer decided in your favour. {amount} from order {reference} has gone back to your balance.",
        "lost": "The card issuer decided against you. {amount} from order {reference} will not come back."
      },
      "reasonLabel": "Reason given:",
      "deadline": "Respond by {date}.",
      "deadlineWarning": "If you do not send evidence to Stripe by then, the dispute is lost automatically.",
      "viewOrder": "Open the order",
      "footer": "Answer the dispute from your Stripe dashboard. The order is marked as disputed in your admin panel and cannot be refunded while the dispute is open.",
      "reasons": {
        "fraudulent": "the cardholder says they did not authorise the payment",
        "product_not_received": "the customer says the order never arrived",
        "product_unacceptable": "the customer says the goods were not as described, or arrived damaged",
        "duplicate": "the customer says they were charged twice",
        "subscription_canceled": "the customer says the subscription was cancelled",
        "unrecognized": "the cardholder does not recognise the charge",
        "credit_not_processed": "the customer says a refund they were promised never arrived",
        "general": "no reason was given"
      }
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
    },
    "subscribe": {
      "subject": "{shop}: please confirm your subscription",
      "headline": "One more step",
      "intro": "Please confirm that you would like news and offers from {shop} by email.",
      "button": "Confirm my subscription",
      "expires": "The button works for 7 days.",
      "ignore": "If you did not sign up, ignore this email: you will not be added, and you will not hear from us again."
    }
  },
  "Home": {
    "__after__": "Nav",
    "tagline": "Welcome to {shop}",
    "browse": "Browse the shop"
  },
  "Newsletter": {
    "heading": "Stay in the loop",
    "intro": "News, new arrivals and offers from {shop}, about once a month.",
    "email": "Email address",
    "firstName": "First name (optional)",
    "submit": "Sign up",
    "sending": "Signing up…",
    "consent": "Yes, send me news and offers from {shop} by email. I can unsubscribe at any time.",
    "thanks": "Almost there: we have sent you an email. Press the button in it to confirm your subscription.",
    "invalidEmail": "Please enter a valid email address.",
    "failed": "That did not work. Please try again in a moment.",
    "checkoutOptIn": "Email me news and offers. I can unsubscribe at any time.",
    "backToShop": "Back to the shop",
    "confirm": {
      "title": "Confirm your subscription",
      "body": "Press the button to start receiving news and offers from {shop} at {email}.",
      "button": "Confirm my subscription",
      "confirmed": "You are subscribed. Welcome!",
      "alreadySubscribed": "You are already subscribed.",
      "unsubscribed": "This link is from before you unsubscribed, so it no longer works. You can sign up again at the bottom of any page.",
      "invalid": "This link does not work. It may have been cut short when copied.",
      "expired": "This link has expired. Sign up again at the bottom of any page to get a new one.",
      "unavailable": "The newsletter is not available at the moment."
    },
    "unsubscribe": {
      "title": "Unsubscribe",
      "body": "Press the button to stop receiving news and offers from {shop} at {email}.",
      "button": "Unsubscribe",
      "done": "You are unsubscribed. You will not receive any more news from {shop}.",
      "changedMind": "Changed your mind? You can sign up again at the bottom of any page.",
      "alreadyDone": "You are already unsubscribed.",
      "invalid": "This link does not work. It may have been cut short when copied.",
      "unavailable": "Unsubscribing is not available at the moment. Please reply to the email instead.",
      "preview": "This is a preview. In a real email, this link takes the reader to this page with a button that unsubscribes them."
    }
  },
  "Footer": {
    "copyright": "© {year} {shop}"
  }
}
EOF
cat > src/messages/de.json <<'EOF'
{
  "Auth": {
    "email": "E-Mail",
    "password": "Passwort",
    "confirmPassword": "Passwort bestätigen",
    "code": "Sechsstelliger Code",
    "checking": "Wird geprüft…",
    "sending": "Wird gesendet…",
    "saving": "Wird gespeichert…",
    "signIn": {
      "title": "Anmelden",
      "submit": "Anmelden",
      "forgot": "Passwort vergessen?",
      "noAccount": "Neu hier? Konto erstellen",
      "useCode": "Stattdessen mit einem E-Mail-Code anmelden",
      "ownerPassword": "Shop-Inhaber? Mit Passwort anmelden",
      "confirmationFailed": "Dieser Link hat nicht funktioniert. Vielleicht ist er abgelaufen oder wurde schon benutzt: Melden Sie sich an oder fordern Sie einen neuen an."
    },
    "signUp": {
      "title": "Konto erstellen",
      "submit": "Konto erstellen",
      "haveAccount": "Sie haben schon ein Konto? Anmelden",
      "checkEmailTitle": "Prüfen Sie Ihr Postfach",
      "checkEmail": "Wir haben einen Bestätigungslink an <strong>{email}</strong> gesendet. Klicken Sie darauf, um Ihr Konto zu aktivieren."
    },
    "otp": {
      "send": "Code per E-Mail senden",
      "sent": "Wir haben einen sechsstelligen Code an <strong>{email}</strong> gesendet. Geben Sie ihn unten ein.",
      "restart": "Andere E-Mail verwenden oder Code erneut senden"
    },
    "mfa": {
      "title": "Zwei-Faktor-Authentifizierung",
      "preparing": "Wird vorbereitet…",
      "enrolHint": "Scannen Sie diesen Code mit Ihrer Authenticator-App (Google Authenticator, Authy, 1Password…) und geben Sie dann den angezeigten sechsstelligen Code ein.",
      "qrAlt": "QR-Code für Ihre Authenticator-App",
      "manualKey": "Scannen klappt nicht? Geben Sie diesen Schlüssel von Hand ein:",
      "verifyHint": "Geben Sie den Code aus Ihrer Authenticator-App ein.",
      "activate": "Aktivieren",
      "continue": "Weiter"
    },
    "reset": {
      "title": "Passwort zurücksetzen",
      "hint": "Geben Sie die E-Mail-Adresse Ihres Kontos ein, und wir senden Ihnen einen Link, um ein neues Passwort zu wählen.",
      "submit": "Link senden",
      "sent": "Wenn es zu dieser Adresse ein Konto gibt, ist ein Link für ein neues Passwort unterwegs.",
      "backToSignIn": "Zurück zur Anmeldung"
    },
    "update": {
      "title": "Neues Passwort wählen",
      "submit": "Neues Passwort speichern",
      "done": "Ihr Passwort wurde geändert.",
      "continue": "Weiter einkaufen",
      "noSession": "Dieser Link ist abgelaufen oder wurde schon benutzt.",
      "requestNew": "Neuen Link anfordern"
    },
    "errors": {
      "passwordsDiffer": "Die Passwörter stimmen nicht überein.",
      "invalidCredentials": "E-Mail und Passwort passen zu keinem Konto.",
      "emailNotConfirmed": "Bestätigen Sie zuerst Ihre E-Mail-Adresse: Der Link steht in der E-Mail, die wir Ihnen gesendet haben.",
      "rateLimited": "Zu viele Versuche. Warten Sie eine Minute und versuchen Sie es erneut.",
      "codeInvalid": "Dieser Code ist falsch oder abgelaufen.",
      "userExists": "Zu dieser E-Mail gibt es schon ein Konto. Melden Sie sich stattdessen an.",
      "weakPassword": "Wählen Sie ein längeres oder weniger gängiges Passwort.",
      "samePassword": "Das neue Passwort muss sich vom alten unterscheiden.",
      "generic": "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut."
    }
  },
  "Nav": {
    "Shop": "Shop",
    "Cart": "Warenkorb",
    "Checkout": "Kasse",
    "Account": "Konto",
    "Home": "Startseite",
    "admin": "Admin",
    "orders": "Bestellungen",
    "signIn": "Anmelden",
    "signUp": "Registrieren",
    "signOut": "Abmelden"
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
      "refunded": "Erstattet",
      "disputed": "Zahlung angefochten"
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
    "settings": {
      "heading": "Einstellungen",
      "subheading": "Wie sich Ihr Shop zeigt. Änderungen erscheinen beim nächsten Seitenaufruf.",
      "shop": {
        "heading": "Shop",
        "hint": "Das Grundlegende, das Kunden auf jeder Seite und in jeder E-Mail sehen.",
        "name": "Shop-Name",
        "nameHint": "Im Kopfbereich, in Seitentiteln, Suchergebnissen und E-Mails.",
        "nameFromDefault": "Noch nicht gespeichert: Das ist der Name aus der Einrichtung. Speichern Sie ihn, um ihn festzulegen.",
        "logo": "Logo",
        "logoHint": "Erscheint im Kopfbereich statt des Namens, in Suchergebnissen und in E-Mails, sofern die E-Mail-Marke kein eigenes hat.",
        "modeHeading": "Was Sie verkaufen",
        "mode_generic": "Gewöhnliche Produkte",
        "mode_generic_hint": "Name, Preis, Fotos und die unten angehakten Produktfelder.",
        "mode_chilli": "Chilis und scharfe Saucen",
        "mode_chilli_hint": "Ergänzt Produkte um Schärfe, Scoville und Chilisorten. Beim Zurückschalten werden sie nur ausgeblendet, nichts Eingegebenes wird gelöscht.",
        "currency": "Währung",
        "currencyHint": "Jeder Preis im Shop ist in dieser Währung. Ein Wechsel rechnet nichts um: Jede Zahl behält ihren Wert und bekommt das neue Kürzel, daher muss vorher alles Bepreiste umgestellt werden.",
        "conflictProducts": "{count, plural, one {Dieses Produkt ist} other {Diese Produkte sind}} in einer anderen Währung ausgezeichnet — öffnen und mit neuem Preis speichern:",
        "conflictDiscounts": "{count, plural, one {Dieser Gutscheincode ist} other {Diese Gutscheincodes sind}} in einer anderen Währung — unter Gutscheincodes neu anlegen:",
        "conflictMore": "…und {count} weitere.",
        "brandsHeading": "Marken",
        "brands_single": "Nur eigene Produkte",
        "brands_single_hint": "Eine Marke ist bei Produkten optional. Hat Ihr Shop noch keine, wird eine mit dem Namen des Shops angelegt.",
        "brands_multi": "Produkte mehrerer Marken",
        "brands_multi_hint": "Jedes Produkt braucht eine Marke. Vorher gespeicherte Produkte behalten ihre.",
        "save": "Speichern",
        "saving": "Wird gespeichert…",
        "savedNotice": "Gespeichert. Die Änderungen sind aktiv.",
        "errors": {
          "not_authorized": "Das dürfen Sie nicht.",
          "mfa_required": "Geben Sie zuerst Ihren Authenticator-Code ein und versuchen Sie es erneut.",
          "currency_conflict": "Nicht gespeichert: Einige Preise sind noch in einer anderen Währung.",
          "invalid": "Geben Sie einen Namen mit höchstens 80 Zeichen ein.",
          "failed": "Die Einstellungen konnten nicht gespeichert werden.",
          "rescale_failed": "Die Skala wurde gespeichert, Ihre Produkte tragen aber noch die alten Zahlen. Bitte erneut speichern."
        }
      },
      "checkout": {
        "heading": "Kasse",
        "hint": "Wer die Lieferadresse abfragt und wohin Sie liefern.",
        "addressHeading": "Lieferadresse",
        "address_form": "Auf Ihrer Kassenseite abfragen",
        "address_form_hint": "Die Kundin gibt die Adresse vor der Zahlung in Ihrem Shop ein.",
        "address_stripe": "Auf der Zahlungsseite von Stripe abfragen",
        "address_stripe_hint": "Stripe erfasst die Adresse zusammen mit der Zahlung.",
        "countries": "Lieferländer",
        "countriesHint": "Die Länder, die an der Kasse zur Auswahl stehen. Mindestens eines.",
        "countriesFromDefault": "Noch nicht gespeichert: Das ist die Liste aus der Einrichtung. Speichern Sie sie, um sie festzulegen.",
        "search": "Länder suchen",
        "selected": "{count, plural, one {# Land} other {# Länder}} ausgewählt",
        "save": "Speichern",
        "saving": "Wird gespeichert…",
        "savedNotice": "Gespeichert. Die Kasse richtet sich nach den neuen Einstellungen.",
        "errors": {
          "not_authorized": "Das dürfen Sie nicht.",
          "mfa_required": "Geben Sie zuerst Ihren Authenticator-Code ein und versuchen Sie es erneut.",
          "invalid": "Wählen Sie mindestens ein Lieferland aus.",
          "failed": "Die Einstellungen konnten nicht gespeichert werden.",
          "rescale_failed": "Die Skala wurde gespeichert, Ihre Produkte tragen aber noch die alten Zahlen. Bitte erneut speichern."
        }
      },
      "shipping": {
        "heading": "Versand",
        "hint": "Was der Versand einer Bestellung kostet und von wo Sie versenden.",
        "fromDefault": "Noch nicht gespeichert: Das sind die Platzhalter aus der Einrichtung. Speichern Sie sie, um sie festzulegen.",
        "flatRate": "Pauschale pro Bestellung ({currency})",
        "flatRateHint": "Fällig bei jeder Bestellung unter der Versandkostenfrei-Grenze.",
        "freeShippingThreshold": "Versandkostenfrei ab ({currency})",
        "freeShippingThresholdHint": "Bestellungen ab diesem Betrag versenden kostenlos. Leer lassen, um nie kostenlos zu versenden.",
        "label": "Name an der Kasse",
        "labelHint": "Steht neben den Versandkosten, auch auf der Stripe-Seite.",
        "itemWeight": "Gewicht pro Artikel (g)",
        "itemWeightHint": "Für das Paketgewicht, das an Stripe gemeldet wird.",
        "boxWeight": "Gewicht des leeren Kartons (g)",
        "boxWeightHint": "Wird einmal pro Bestellung hinzugezählt.",
        "homeCountry": "Versand aus",
        "homeCountryHint": "Das Land, das Ihre Widerrufsangaben nennen. Die Rücksendeadresse wird es ebenfalls verwenden.",
        "homeCountryUnset": "Nicht festgelegt — das erste Ihrer Lieferländer",
        "save": "Speichern",
        "saving": "Wird gespeichert…",
        "savedNotice": "Gespeichert. Neue Bestellungen verwenden die neuen Sätze.",
        "errors": {
          "not_authorized": "Das dürfen Sie nicht.",
          "mfa_required": "Geben Sie zuerst Ihren Authenticator-Code ein und versuchen Sie es erneut.",
          "invalid": "Prüfen Sie Beträge und Gewichte und versuchen Sie es erneut.",
          "failed": "Die Einstellungen konnten nicht gespeichert werden.",
          "rescale_failed": "Die Skala wurde gespeichert, Ihre Produkte tragen aber noch die alten Zahlen. Bitte erneut speichern."
        }
      },
      "auth": {
        "heading": "Anmeldung und Sicherheit",
        "hint": "Wie Kundinnen sich anmelden und wie Sie in die Verwaltung kommen.",
        "fromDefault": "Noch nicht gespeichert: So wurde der Shop eingerichtet. Speichern Sie, um es festzulegen.",
        "customerHeading": "Anmeldung für Kundinnen",
        "customer_password": "E-Mail und Passwort",
        "customer_password_hint": "Kundinnen wählen ein Passwort und können es per E-Mail zurücksetzen.",
        "customer_otp": "E-Mail und sechsstelliger Code",
        "customer_otp_hint": "Keine Passwörter für Kundinnen: Jede Anmeldung schickt einen Code. Ihres behalten Sie für die Verwaltung.",
        "mfaHeading": "Ihr zweiter Faktor",
        "mfa_required": "Passwort und Authenticator-Code",
        "mfa_required_hint": "Die Verwaltung fragt bei jeder neuen Sitzung nach dem Code aus Ihrer Authenticator-App.",
        "mfa_off": "Nur Passwort",
        "mfa_off_hint": "Schneller hinein und nur so sicher wie Ihr Passwort.",
        "mfaOffWarning": "Beim Speichern wird die Authenticator-App aus Ihrem Konto entfernt, und Ihr Passwort allein öffnet die Verwaltung.",
        "save": "Speichern",
        "saving": "Wird gespeichert…",
        "savedNotice": "Gespeichert. Die Anmeldung richtet sich nach den neuen Einstellungen.",
        "errors": {
          "not_authorized": "Das dürfen Sie nicht.",
          "mfa_required": "Geben Sie zuerst Ihren Authenticator-Code ein und versuchen Sie es erneut.",
          "invalid": "Wählen Sie in jeder Gruppe eine Option.",
          "failed": "Die Einstellungen konnten nicht gespeichert werden.",
          "rescale_failed": "Die Skala wurde gespeichert, Ihre Produkte tragen aber noch die alten Zahlen. Bitte erneut speichern."
        }
      },
      "productFields": {
        "heading": "Produktfelder",
        "hint": "Wonach das Produktformular fragt. Jedes Feld existiert bereits in der Datenbank, Einschalten genügt.",
        "fromDefault": "Noch nicht gespeichert: Das sind die Felder aus der Einrichtung. Speichern Sie sie, um sie festzulegen.",
        "selected": "{count, plural, =0 {Keine Felder} one {# Feld} other {# Felder}} ausgewählt",
        "switchingOff": "Ein ausgeschaltetes Feld verschwindet aus dem Formular und aus dem Shop. Gespeicherte Inhalte bleiben erhalten und sind nach dem Wiedereinschalten wieder da.",
        "save": "Speichern",
        "saving": "Wird gespeichert…",
        "savedNotice": "Gespeichert. Das Produktformular richtet sich nach den neuen Einstellungen.",
        "errors": {
          "not_authorized": "Das dürfen Sie nicht.",
          "mfa_required": "Geben Sie zuerst Ihren Authenticator-Code ein und versuchen Sie es erneut.",
          "invalid": "Diese Felder konnten nicht gespeichert werden.",
          "failed": "Die Einstellungen konnten nicht gespeichert werden.",
          "rescale_failed": "Die Skala wurde gespeichert, Ihre Produkte tragen aber noch die alten Zahlen. Bitte erneut speichern."
        }
      },
      "heat": {
        "heading": "Schärfe",
        "hint": "Wie scharf Ihre Produkte sind und wie das im Shop erscheint.",
        "fromDefault": "Noch nicht gespeichert: Das ist die Skala aus der Einrichtung. Speichern Sie sie, um sie festzulegen.",
        "max": "Obergrenze der Skala",
        "maxHint": "Schärfe reicht von 0 bis zu dieser Zahl. Zehn ist ein guter Standard, zwanzig für feinere Abstufungen.",
        "rescaleWarning": "Beim Speichern werden alle Produkte von der {from}er- auf die {to}er-Skala umgerechnet, jeweils im gleichen Verhältnis. Es geht nichts verloren, aber die Zahlen an Ihren Produkten ändern sich.",
        "displayHeading": "Darstellung der Schärfe",
        "display_number": "Die Zahl",
        "display_word": "Das Wort",
        "display_both": "Wort und Zahl",
        "display_peppers": "Chili-Symbole",
        "displayEmpty": "Nichts, solange ein Produkt keine Schärfe hat",
        "bandsHeading": "Wörter",
        "bandsHint": "Jedes Wort gilt bis zu seiner Zahl; ein Produkt erhält das erste Wort, in dessen Bereich es fällt.",
        "bandsEmpty": "Keine Wörter: Die Schärfe erscheint nur als Zahl.",
        "bandWord": "Wort",
        "bandUpTo": "Bis",
        "bandAdd": "Wort hinzufügen",
        "bandRemove": "Entfernen",
        "save": "Speichern",
        "saving": "Wird gespeichert…",
        "savedNotice": "Gespeichert. Der Shop folgt der neuen Skala.",
        "errors": {
          "not_authorized": "Das dürfen Sie nicht.",
          "mfa_required": "Geben Sie zuerst Ihren Authenticator-Code ein und versuchen Sie es erneut.",
          "invalid": "Prüfen Sie Skala und Wörter und versuchen Sie es erneut.",
          "failed": "Die Einstellungen konnten nicht gespeichert werden.",
          "rescale_failed": "Die Skala wurde gespeichert, Ihre Produkte tragen aber noch die alten Zahlen. Bitte erneut speichern."
        }
      }
    },
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
      "email": "E-Mail",
      "settings": "Einstellungen"
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
    "dispute": {
      "heading": "Rückbuchung",
      "openNotice": "Diese Zahlung wurde angefochten. Stripe hält {amount} von Ihrem Guthaben zurück, solange die Bank entscheidet.",
      "wonNotice": "Sie haben diesen Fall gewonnen. {amount} ist zurück auf Ihrem Guthaben.",
      "lostNotice": "Dieser Fall ging verloren. {amount} kam nicht zurück, und die Bestellung bleibt als angefochten markiert.",
      "deadline": "Nachweise sind fällig bis zum {date}.",
      "noDeadline": "Stripe hat hierfür keine Frist genannt.",
      "reason": "Grund: {reason}",
      "opened": "Eröffnet am {date}",
      "closed": "Abgeschlossen am {date}",
      "answerInStripe": "Bearbeiten Sie den Fall in Ihrem Stripe-Dashboard.",
      "refundBlocked": "Eine Bestellung kann nicht erstattet werden, solange sie angefochten wird.",
      "statuses": {
        "warning_needs_response": "Frühwarnung: Antwort nötig",
        "warning_under_review": "Frühwarnung: in Prüfung",
        "warning_closed": "Frühwarnung: abgeschlossen",
        "needs_response": "Antwort nötig",
        "under_review": "In Prüfung",
        "won": "Gewonnen",
        "lost": "Verloren"
      }
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
      "amountIn": "Betrag Rabatt ({currency})",
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
      "comingSoon": "Kampagnen werden im Reiter Kampagnen gesendet; ein Test aus einer Vorlage geht an eine Adresse.",
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
        "sampleNote": "Platzhalter zeigen einen Beispiel-Abonnenten namens {name}. Der Abmeldelink öffnet die Abmeldeseite als Vorschau."
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
      },
      "tabs": {
        "label": "E-Mail",
        "templates": "Vorlagen",
        "subscribers": "Abonnenten",
        "campaigns": "Kampagnen",
        "settings": "Einstellungen"
      },
      "subscribers": {
        "heading": "Abonnenten",
        "subheading": "Alle, die sich für den Newsletter angemeldet haben, mit Zeitpunkt und Art ihrer Zustimmung. Nur bestätigte Abonnenten erhalten Kampagnen.",
        "disabled": {
          "email-not-configured": "Die Anmeldung ist ausgeschaltet: E-Mail ist nicht eingerichtet (RESEND_API_KEY und EMAIL_FROM), es könnte keine Bestätigung verschickt werden.",
          "no-signing-secret": "Die Anmeldung ist ausgeschaltet: EMAIL_SIGNING_SECRET fehlt oder ist kürzer als 32 Zeichen.",
          "no-site-url": "Die Anmeldung ist ausgeschaltet: NEXT_PUBLIC_SITE_URL ist nicht gesetzt, die Links in E-Mails hätten kein Ziel."
        },
        "notices": {
          "unsubscribed": "Abgemeldet.",
          "deleted": "Gelöscht, samt Verlauf.",
          "resent": "Bestätigungs-E-Mail erneut gesendet.",
          "not_authorized": "Das darf nur der Shop-Inhaber.",
          "not_found": "Diesen Abonnenten gibt es nicht mehr.",
          "not_pending": "Die Bestätigung kann nur erneut an Personen gehen, die noch nicht bestätigt haben.",
          "failed": "Etwas ist schiefgegangen. Bitte versuchen Sie es erneut.",
          "updated": "Gespeichert.",
          "invalid": "Diese Sprache gehört nicht zum Shop."
        },
        "status": {
          "pending": "Wartet auf Bestätigung",
          "subscribed": "Angemeldet",
          "unsubscribed": "Abgemeldet"
        },
        "search": "Nach E-Mail suchen",
        "searchButton": "Suchen",
        "exportAll": "Alle als CSV herunterladen",
        "exportFiltered": "„{status}“ als CSV herunterladen",
        "noMatches": "Keine Treffer.",
        "empty": "Noch hat sich niemand angemeldet. Das Anmeldeformular steht unten auf jeder Seite.",
        "columns": {
          "email": "E-Mail",
          "language": "Sprache",
          "status": "Status",
          "source": "Angemeldet über",
          "dates": "Wann",
          "actions": "Aktionen"
        },
        "sources": {
          "footer": "Formular unten",
          "checkout": "Kasse",
          "import": "Import",
          "admin": "Admin"
        },
        "signedUp": "Angefragt am {date}",
        "confirmedOn": "Bestätigt am {date}",
        "unsubscribedOn": "Abgemeldet am {date}",
        "consentShown": "Wozu zugestimmt wurde",
        "resend": "Bestätigung erneut senden",
        "unsubscribe": "Abmelden",
        "confirmUnsubscribe": "{email} abmelden? Die Person kann sich selbst wieder anmelden.",
        "delete": "Löschen",
        "confirmDelete": "{email} samt Verlauf endgültig löschen? Für den Fall, dass jemand vergessen werden möchte.",
        "pagination": "Seiten",
        "previous": "Zurück",
        "next": "Weiter",
        "pageOf": "Seite {page} von {pages}",
        "importHeading": "Aus einem anderen Dienst importieren",
        "importIntro": "Eine CSV-Datei mit einer E-Mail-Spalte, optional Vorname und Sprache, etwa ein Export aus Mailchimp. Wer schon auf der Liste steht, bleibt unverändert, und wer sich abgemeldet hat, wird nicht wieder hinzugefügt.",
        "importConsent": "Diese Personen haben zugestimmt, E-Mails von diesem Shop zu erhalten, und ich kann das auf Nachfrage belegen.",
        "importing": "Wird importiert…",
        "import": "Importieren",
        "importDone": "{added, plural, =0 {Niemand Neues hinzuzufügen.} one {# Abonnent hinzugefügt.} other {# Abonnenten hinzugefügt.}}",
        "importSkipped": "Übersprungen: {existing} schon auf der Liste, {unsubscribed} abgemeldet, {duplicates} doppelt, {invalid} keine E-Mail-Adresse.",
        "importBadLine": "Zeile {line}: {value}",
        "errors": {
          "notAuthorized": "Nur der Shop-Inhaber kann importieren.",
          "noFile": "Wählen Sie eine CSV-Datei.",
          "tooLarge": "Die Datei ist zu groß: höchstens 10.000 Personen und 2 MB auf einmal.",
          "noConsent": "Bestätigen Sie mit dem Häkchen, dass diese Personen zugestimmt haben.",
          "empty": "Die Datei enthält keine Adressen.",
          "failed": "Der Import wurde abgebrochen: {message}"
        },
        "importConsentRecord": "Importiert am {date} vom Inhaber von {shop}, der bestätigt hat, dass diese Person dem E-Mail-Empfang vom Shop zugestimmt hatte.",
        "edit": "Bearbeiten",
        "editName": "Vorname",
        "editLanguage": "Sprache",
        "editSave": "Speichern"
      },
      "campaigns": {
        "heading": "Kampagnen",
        "subheading": "Eine Vorlage, gesendet an alle mit bestätigtem Abonnement, ein Versand pro Sprache, über Resend.",
        "notConfigured": "Zum Senden braucht es RESEND_API_KEY und EMAIL_FROM in der Umgebung des Shops.",
        "newHeading": "Neue Kampagne",
        "noTemplates": "Legen Sie zuerst unter Vorlagen eine Vorlage an.",
        "name": "Name",
        "template": "Vorlage",
        "creating": "Wird angelegt…",
        "create": "Entwurf anlegen",
        "empty": "Noch keine Kampagnen.",
        "columns": {
          "name": "Name",
          "status": "Status",
          "recipients": "Empfänger",
          "when": "Wann",
          "actions": "Aktionen"
        },
        "status": {
          "draft": "Entwurf",
          "scheduled": "Geplant",
          "sending": "Wird gesendet",
          "sent": "Gesendet",
          "failed": "Fehlgeschlagen"
        },
        "sentOn": "Gesendet {date}",
        "scheduledFor": "Geplant für {date}",
        "createdOn": "Angelegt {date}",
        "confirmDelete": "Den Entwurf „{name}“ löschen?",
        "delete": "Löschen",
        "notices": {
          "deleted": "Entwurf gelöscht."
        },
        "errors": {
          "not_authorized": "Das darf nur der Shop-Inhaber.",
          "not_found": "Diese Kampagne gibt es nicht mehr.",
          "name": "Geben Sie der Kampagne einen Namen mit höchstens 120 Zeichen.",
          "template": "Wählen Sie eine Vorlage.",
          "template_invalid": "Diese Vorlage hat Probleme; öffnen Sie sie zuerst im Designer und speichern Sie.",
          "not_draft": "Nur Entwürfe können gesendet oder gelöscht werden.",
          "schedule_invalid": "Das ist keine gültige Zeit.",
          "schedule_past": "Wählen Sie eine Zeit, die mindestens 5 Minuten in der Zukunft liegt.",
          "schedule_too_far": "Wählen Sie eine Zeit innerhalb der nächsten 30 Tage.",
          "not_configured": "Zum Senden braucht es RESEND_API_KEY und EMAIL_FROM.",
          "nobody": "Noch hat niemand ein Abonnement bestätigt.",
          "audience_missing": "Die Liste für {message} wurde noch nicht synchronisiert. Zuerst synchronisieren.",
          "not_synced": "Die Liste für {message} hat noch nicht synchronisierte Änderungen. Zuerst synchronisieren.",
          "failed": "Etwas ist schiefgegangen: {message}"
        },
        "back": "Alle Kampagnen",
        "progressHeading": "Fortschritt",
        "refresh": "Status aktualisieren",
        "recipientsTotal": "{count, plural, one {# Empfänger} other {# Empfänger}}",
        "recipientsCount": "{count, plural, one {# Empfänger} other {# Empfänger}}",
        "localeStatus": {
          "pending": "Wird vorbereitet",
          "queued": "Wird gesendet",
          "scheduled": "Geplant",
          "sent": "Gesendet",
          "failed": "Fehlgeschlagen",
          "skipped": "Niemand in dieser Sprache"
        },
        "cancelHint": "Um eine geplante Kampagne abzusagen, stornieren Sie ihre Sendungen im Resend-Dashboard und aktualisieren Sie hier den Status.",
        "snapshotNote": "Dies ist eine Kopie der Vorlage, wie sie beim Anlegen der Kampagne war. Änderungen an der Vorlage wirken sich nicht aus.",
        "sync": {
          "heading": "Die Liste bei Resend",
          "intro": "Vor dem Senden werden alle Bestätigten in ein Resend-Publikum ihrer Sprache übertragen, und wer sich über Resend abgemeldet hat, wird zurückgelesen. Resend nimmt eine Person pro Anfrage, daher dauert die erste Synchronisierung einer großen Liste eine Weile; lassen Sie diese Seite offen.",
          "running": "Wird synchronisiert…",
          "syncNow": "{count, plural, one {# Änderung} other {# Änderungen}} synchronisieren",
          "syncAgain": "Erneut synchronisieren",
          "language": "Sprache",
          "recipients": "Erhalten sie",
          "toSync": "Zu synchronisieren",
          "state": "Stand",
          "pushing": "Bisher {count} übertragen…",
          "error": "Abgebrochen: {message}",
          "done": "Fertig: {pushed} übertragen, {pulled} bei Resend abgemeldet.",
          "nobody": "Niemand",
          "noAudience": "Noch nicht synchronisiert",
          "outOfDate": "Änderungen offen",
          "upToDate": "Aktuell"
        },
        "send": {
          "heading": "Senden",
          "intro": "{count, plural, =0 {Noch niemand würde sie erhalten.} one {# Person erhält sie.} other {# Personen erhalten sie.}}",
          "now": "Jetzt senden",
          "later": "Planen",
          "time": "Zeit",
          "timeHint": "In Ihrer Zeitzone ({zone}); innerhalb der nächsten 30 Tage.",
          "notReady": "Synchronisieren Sie zuerst die Liste und prüfen Sie, dass der Versand eingerichtet ist.",
          "sending": "Wird gesendet…",
          "schedule": "Planen",
          "sendNow": "Jetzt senden",
          "confirmNow": "Diese Kampagne jetzt an {count, plural, one {# Person} other {# Personen}} senden? Das lässt sich nicht rückgängig machen.",
          "confirmLater": "Diese Kampagne für {count, plural, one {# Person} other {# Personen}} um {time} planen?"
        }
      },
      "settings": {
        "heading": "E-Mail-Einstellungen",
        "subheading": "Welcher Anbieter die E-Mails dieses Shops verschickt und mit welchen Schlüsseln.",
        "campaignProviderLabel": "Kampagnen über",
        "transactionalLabel": "Belege über",
        "transactionalNote": "Belege sowie Erstattungs- und Versand-E-Mails laufen immer über Resend. Mailchimp bietet hinter diesem Schlüssel keinen Transaktionsversand, daher werden beide getrennt eingestellt — ein Shop kann den Newsletter über Mailchimp und die Belege über Resend verschicken.",
        "providerNone": "Niemand — dieser Shop kann noch keine E-Mails senden",
        "senderLabel": "Absenderadresse",
        "senderMissing": "Nicht gesetzt",
        "senderRequired": "Setzen Sie EMAIL_FROM auf eine beim Anbieter bestätigte Absenderadresse. Ohne sie kann auch mit Schlüssel nichts verschickt werden.",
        "providers": {
          "resend": "Resend",
          "mailchimp": "Mailchimp"
        },
        "providerBlurbs": {
          "resend": "Eine Zielgruppe je Sprache, automatisch angelegt. Am einfachsten, wenn Sie noch keine Liste haben.",
          "mailchimp": "Ihre vorhandene Mailchimp-Zielgruppe, mit einem Tag je Sprache. Passend, wenn Ihre Liste schon dort liegt."
        },
        "providerNeedsKey": "Hinterlegen Sie unten einen Schlüssel, um diesen Anbieter wählen zu können.",
        "activeBadge": "Verschickt Kampagnen",
        "choiceHeading": "Welcher Anbieter Kampagnen verschickt",
        "choiceHint": "Betrifft nur Newsletter. Belege bleiben unberührt.",
        "choiceLocked": "In der Umgebung dieses Shops ist EMAIL_CAMPAIGN_PROVIDER gesetzt und entscheidet darüber. Entfernen Sie die Variable, um hier zu wählen.",
        "choose": "Diesen Anbieter verwenden",
        "choosing": "Wird umgestellt…",
        "chosenNotice": "Kampagnen laufen jetzt über {provider}. Synchronisieren Sie jede Sprache vor der nächsten Kampagne erneut: Die Zielgruppen beim neuen Anbieter sind zunächst leer.",
        "stored": "Ein Schlüssel ist gespeichert. Hinzugefügt am {date}.",
        "storedWithHint": "Ein Schlüssel mit der Endung {hint} ist gespeichert. Hinzugefügt am {date}.",
        "notStored": "Hier ist noch kein Schlüssel gespeichert.",
        "fromEnvironment": "In der Umgebung dieses Shops ist {variable} gesetzt, und dieser Schlüssel wird verwendet. Ein hier gespeicherter Schlüssel bleibt erhalten, wird aber ignoriert, solange die Umgebungsvariable gesetzt ist.",
        "keyLabel": "API-Schlüssel",
        "replaceLabel": "Schlüssel ersetzen",
        "keyPlaceholders": {
          "resend": "re_…",
          "mailchimp": "…-us21"
        },
        "keyHints": {
          "resend": "Aus Ihrem Resend-Dashboard unter „API Keys“. Senderechte genügen.",
          "mailchimp": "Aus Mailchimp unter Account → Extras → API keys. Er endet auf Ihr Rechenzentrum, etwa -us21."
        },
        "writeOnlyWarning": "Der Schlüssel wird beim Anbieter getestet und nur gespeichert, wenn er funktioniert. Danach ist er verschlüsselt und kann nicht wieder angezeigt werden — weder hier noch sonst im Adminbereich. Bewahren Sie Ihre eigene Kopie beim Anbieter auf; zum Ändern geben Sie einen neuen ein.",
        "testing": "Wird getestet…",
        "testAndSave": "Testen und speichern",
        "savedNotice": "Gespeichert. Der Schlüssel mit der Endung {hint} wurde vom Anbieter akzeptiert. Er kann nicht wieder angezeigt werden — eine Kopie bekommen Sie nur beim Anbieter.",
        "remove": "Diesen Schlüssel entfernen",
        "removing": "Wird entfernt…",
        "removeHint": "Löscht den gespeicherten Schlüssel. War es der sendende, übernimmt der andere gespeicherte Schlüssel.",
        "removedNotice": "Der gespeicherte Schlüssel wurde entfernt.",
        "mailchimpListNote": "Mailchimp sendet an die Zielgruppe, die Ihr Konto bereits hat, und versieht jede Person mit einem Sprach-Tag (lang-en, lang-de und so weiter). Hat Ihr Konto mehrere Zielgruppen, setzen Sie MAILCHIMP_LIST_ID auf die gewünschte.",
        "samples": {
          "heading": "Beispiele",
          "hint": "Jede E-Mail für eine erfundene Bestellung, in Ihrer Sprache und der gespeicherten Marke. Erst speichern, dann ansehen oder sich selbst eine schicken.",
          "preview": "Vorschau",
          "send": "Dieses Beispiel an mich senden",
          "sending": "Wird gesendet…",
          "sentNotice": "An {to} gesendet. Prüfen Sie Ihren Posteingang (und den Spam-Ordner).",
          "notConfigured": "Richten Sie zuerst Absender und Schlüssel ein.",
          "subjectPrefix": "[Beispiel] {subject}",
          "errors": {
            "not_authorized": "Das dürfen Sie nicht.",
            "unknown_kind": "Diese E-Mail versendet der Shop nicht.",
            "no_address": "Ihr Konto hat keine E-Mail-Adresse, an die gesendet werden kann.",
            "not_configured": "Dieser Shop kann noch keine E-Mails senden: Setzen Sie EMAIL_FROM und einen Resend-Schlüssel.",
            "failed": "Das Beispiel konnte nicht gesendet werden."
          }
        },
        "brand": {
          "heading": "Marke",
          "hint": "Logo, Farben, Schrift und Fußzeile, in denen Bestellbestätigung, Versand- und Erstattungs-E-Mails erscheinen. Neue Kampagnenvorlagen beginnen ebenfalls damit.",
          "colours": {
            "brandColor": "Akzentfarbe",
            "textColor": "Textfarbe",
            "backgroundColor": "Seitenhintergrund",
            "contentColor": "Kartenhintergrund"
          },
          "colourHints": {
            "brandColor": "Schaltflächen und Links. Der Schaltflächentext ist schwarz oder weiß, je nachdem, was besser lesbar ist.",
            "textColor": "Überschriften und Fließtext.",
            "backgroundColor": "Hinter der E-Mail.",
            "contentColor": "Hinter dem Text."
          },
          "font": "Schrift",
          "fonts": {
            "system": "System (die des Lesers)",
            "sans": "Helvetica / Arial",
            "serif": "Georgia / Times"
          },
          "logo": "Logo",
          "logoHint": "Oben in jeder E-Mail, verlinkt auf Ihren Shop. Leer lassen, um das Shop-Logo aus den Einstellungen zu verwenden, falls eines gesetzt ist.",
          "logoWidth": "Logobreite",
          "logoWidthHint": "Pixel, 40 bis 300.",
          "footer": "Fußzeile, je Sprache",
          "footerHint": "Ihr Firmenname und Ihre Postanschrift oder ein rechtlicher Hinweis. Erscheint klein unter jeder E-Mail, in der Sprache des Kunden, wo Sie eine angegeben haben.",
          "save": "Marke speichern",
          "saving": "Wird gespeichert…",
          "savedNotice": "Gespeichert. Jede Bestellbestätigung, Versand- und Erstattungs-E-Mail verwendet ab jetzt diese Marke.",
          "previewHeading": "Vorschau",
          "previewHint": "Eine Bestellbestätigung für eine erfundene Bestellung, in Ihrer Sprache und der gespeicherten Marke. Speichern aktualisiert sie.",
          "sampleProductOne": "Beispielprodukt",
          "sampleProductTwo": "Noch ein Beispielprodukt",
          "sampleCustomer": "Jo Beispiel",
          "sampleStreet": "Beispielstraße 1",
          "sampleRefundReason": "Die Flasche kam gesprungen an; das tut uns leid.",
          "copy": {
            "heading": "Wortlaut",
            "hint": "Ihr eigener erster Absatz und Ihre letzte Zeile für jede E-Mail, je Sprache. Lassen Sie ein Feld leer, um den grau gezeigten Standardtext zu behalten. Die Bestelldetails dazwischen werden immer erzeugt.",
            "kinds": {
              "confirmation": "Bestellbestätigung",
              "shipping": "Versandbenachrichtigung",
              "refund": "Erstattungsbenachrichtigung"
            },
            "intro": "Erster Absatz",
            "footer": "Letzte Zeile",
            "noIntro": "Kein erster Absatz, sofern Sie keinen schreiben.",
            "tagsHint": "Persönliche Angaben, die Sie verwenden können:",
            "fallbackName": "zusammen"
          },
          "errors": {
            "not_authorized": "Das dürfen Sie nicht.",
            "invalid": "Hier stimmt etwas nicht. Farben werden als #rrggbb geschrieben, und das Logo muss eine https://-Adresse sein.",
            "failed": "Die Marke konnte nicht gespeichert werden."
          }
        },
        "errors": {
          "not_authorized": "Das dürfen Sie nicht.",
          "unknown_provider": "Diesen Anbieter unterstützt dieser Shop nicht.",
          "empty": "Bitte geben Sie einen Schlüssel ein.",
          "too_short": "Das ist zu kurz für einen Anbieter-Schlüssel.",
          "rejected": "Der Anbieter hat diesen Schlüssel abgelehnt. Prüfen Sie, ob Sie ihn vollständig kopiert haben und ob er noch gültig ist.",
          "unreachable": "Der Anbieter war nicht erreichbar, der Schlüssel wurde nicht getestet und nichts gespeichert. Versuchen Sie es gleich noch einmal.",
          "no_vault": "Supabase Vault ist in diesem Projekt nicht aktiviert, es gibt also keinen sicheren Ort für den Schlüssel. Aktivieren Sie Vault oder setzen Sie den Schlüssel stattdessen in der Umgebung.",
          "no_key": "Hinterlegen Sie zuerst den Schlüssel dieses Anbieters.",
          "failed": "Der Schlüssel konnte nicht gespeichert werden."
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
    "dispute": {
      "subject": {
        "opened": "{shop}: {amount} zu Bestellung {reference} zurückgebucht",
        "won": "{shop}: Sie haben den Fall zu Bestellung {reference} gewonnen",
        "lost": "{shop}: der Fall zu Bestellung {reference} ging verloren"
      },
      "headline": {
        "opened": "Eine Kundin oder ein Kunde hat eine Zahlung angefochten",
        "won": "Der Fall wurde zu Ihren Gunsten entschieden",
        "lost": "Der Fall ging verloren"
      },
      "summary": {
        "opened": "{amount} aus Bestellung {reference} wurde zurückgebucht. Stripe hält den Betrag von Ihrem Guthaben zurück, solange die Bank entscheidet.",
        "won": "Die Bank hat zu Ihren Gunsten entschieden. {amount} aus Bestellung {reference} ist zurück auf Ihrem Guthaben.",
        "lost": "Die Bank hat gegen Sie entschieden. {amount} aus Bestellung {reference} kommt nicht zurück."
      },
      "reasonLabel": "Angegebener Grund:",
      "deadline": "Antworten Sie bis zum {date}.",
      "deadlineWarning": "Wenn Sie Stripe bis dahin keine Nachweise schicken, gilt der Fall automatisch als verloren.",
      "viewOrder": "Bestellung öffnen",
      "footer": "Bearbeiten Sie den Fall in Ihrem Stripe-Dashboard. Die Bestellung ist in Ihrem Adminbereich als angefochten markiert und kann nicht erstattet werden, solange der Fall offen ist.",
      "reasons": {
        "fraudulent": "die Karteninhaberin oder der Karteninhaber gibt an, die Zahlung nicht autorisiert zu haben",
        "product_not_received": "die Bestellung ist laut Kundschaft nie angekommen",
        "product_unacceptable": "die Ware war laut Kundschaft nicht wie beschrieben oder beschädigt",
        "duplicate": "es wurde laut Kundschaft doppelt abgebucht",
        "subscription_canceled": "das Abo war laut Kundschaft gekündigt",
        "unrecognized": "die Karteninhaberin oder der Karteninhaber erkennt die Abbuchung nicht wieder",
        "credit_not_processed": "eine zugesagte Erstattung ist laut Kundschaft nie angekommen",
        "general": "es wurde kein Grund angegeben"
      }
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
    },
    "subscribe": {
      "subject": "{shop}: Bitte bestätigen Sie Ihre Anmeldung",
      "headline": "Noch ein Schritt",
      "intro": "Bitte bestätigen Sie, dass Sie Neuigkeiten und Angebote von {shop} per E-Mail erhalten möchten.",
      "button": "Anmeldung bestätigen",
      "expires": "Die Schaltfläche funktioniert 7 Tage lang.",
      "ignore": "Wenn Sie sich nicht angemeldet haben, ignorieren Sie diese E-Mail: Sie werden nicht eingetragen und hören nicht wieder von uns."
    }
  },
  "Home": {
    "__after__": "Nav",
    "tagline": "Willkommen bei {shop}",
    "browse": "Zum Shop"
  },
  "Newsletter": {
    "heading": "Auf dem Laufenden bleiben",
    "intro": "Neuigkeiten, neue Produkte und Angebote von {shop}, etwa einmal im Monat.",
    "email": "E-Mail-Adresse",
    "firstName": "Vorname (optional)",
    "submit": "Anmelden",
    "sending": "Wird angemeldet…",
    "consent": "Ja, senden Sie mir Neuigkeiten und Angebote von {shop} per E-Mail. Ich kann mich jederzeit abmelden.",
    "thanks": "Fast geschafft: Wir haben Ihnen eine E-Mail geschickt. Bestätigen Sie Ihre Anmeldung mit der Schaltfläche darin.",
    "invalidEmail": "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
    "failed": "Das hat nicht geklappt. Bitte versuchen Sie es gleich noch einmal.",
    "checkoutOptIn": "Senden Sie mir Neuigkeiten und Angebote per E-Mail. Ich kann mich jederzeit abmelden.",
    "backToShop": "Zurück zum Shop",
    "confirm": {
      "title": "Anmeldung bestätigen",
      "body": "Mit der Schaltfläche erhalten Sie künftig Neuigkeiten und Angebote von {shop} an {email}.",
      "button": "Anmeldung bestätigen",
      "confirmed": "Sie sind angemeldet. Willkommen!",
      "alreadySubscribed": "Sie sind bereits angemeldet.",
      "unsubscribed": "Dieser Link stammt aus der Zeit vor Ihrer Abmeldung und gilt nicht mehr. Unten auf jeder Seite können Sie sich neu anmelden.",
      "invalid": "Dieser Link funktioniert nicht. Vielleicht wurde er beim Kopieren abgeschnitten.",
      "expired": "Dieser Link ist abgelaufen. Melden Sie sich unten auf einer beliebigen Seite neu an, um einen neuen zu erhalten.",
      "unavailable": "Der Newsletter ist gerade nicht verfügbar."
    },
    "unsubscribe": {
      "title": "Abmelden",
      "body": "Mit der Schaltfläche erhalten Sie keine Neuigkeiten und Angebote von {shop} mehr an {email}.",
      "button": "Abmelden",
      "done": "Sie sind abgemeldet und erhalten keine Neuigkeiten von {shop} mehr.",
      "changedMind": "Doch anders überlegt? Unten auf jeder Seite können Sie sich jederzeit neu anmelden.",
      "alreadyDone": "Sie sind bereits abgemeldet.",
      "invalid": "Dieser Link funktioniert nicht. Vielleicht wurde er beim Kopieren abgeschnitten.",
      "unavailable": "Die Abmeldung ist gerade nicht möglich. Antworten Sie bitte stattdessen auf die E-Mail.",
      "preview": "Dies ist eine Vorschau. In einer echten E-Mail führt dieser Link zu dieser Seite mit einer Schaltfläche, die abmeldet."
    }
  },
  "Footer": {
    "copyright": "© {year} {shop}"
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
import SiteFooter from '@/components/newsletter/SiteFooter';
import { parseLocale } from '@/lib/i18n/locales';
import { siteUrl } from '@/lib/seo/alternates';
import { googleSiteVerification, shopName } from '@/lib/seo/store';

export const dynamic = 'force-dynamic';

/**
 * Site-wide head defaults. metadataBase makes every relative URL in page
 * metadata absolute (Google requires absolute canonical and hreflang
 * URLs); the pages add their own canonical, hreflang set and description.
 */
export async function generateMetadata(): Promise<Metadata> {
  // The name the owner set in /admin/settings, cached; see lib/settings.
  const name = await shopName();
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: name, template: `%s | ${name}` },
    applicationName: name,
    ...(googleSiteVerification() ? { verification: { google: googleSiteVerification() } } : {})
  };
}

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
          <SiteFooter locale={locale} />
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
import { logoUrl, shippingPolicy, shopName, shopReturnPolicy } from '@/lib/seo/store';

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Home' });
  const name = await shopName();
  return {
    description: t('tagline', { shop: name }),
    alternates: pageAlternates(locale, ''),
    openGraph: { type: 'website', siteName: name, locale: hreflangOf(locale), url: localizedUrl(locale, '') }
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Home' });
  const tNav = await getTranslations({ locale, namespace: 'Nav' });
  const name = await shopName();
  const url = localizedUrl(locale, '');

  return (
    <main className="mx-auto max-w-3xl p-6">
      {/* The shop itself, once, on the home page: site name, policies. */}
      <JsonLd
        data={[
          onlineStoreJsonLd({
            name,
            url,
            logo: await logoUrl(),
            shipping: await shippingPolicy(),
            returnPolicy: await shopReturnPolicy()
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
 * Checkout configuration: what this shop starts with.
 *
 * Written by extend-commerce-template.sh from --shipping=form|stripe.
 * This is the fallback, not the live setting: the Checkout section of
 * /admin/settings writes a store_settings row, and from the moment the
 * owner saves it that row decides (src/lib/settings/). Editing this file
 * changes a shop that has never saved those settings.
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
   * is limited to them too. Placeholder list: pick where you actually ship
   * in the admin, or edit this before the shop's first save.
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
    shopName: await shopName(),
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
import { shippingPolicy, shopName, shopReturnPolicy } from '@/lib/seo/store';
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
      siteName: await shopName(),
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
      shipping: await shippingPolicy(product.currency),
      returnPolicy: await shopReturnPolicy(),
      sellerName: await shopName()
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
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getStoreSetting } from '@/lib/settings/store';
import CartBadge from '@/components/cart/CartBadge';

export default async function Header({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'Nav' });
  const { name: shopName, logoUrl } = await getStoreSetting('shop');
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
          {/* A plain img on purpose: the logo may live on any https host,
              and next/image only serves the hosts in next.config. */}
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={shopName} className="h-8 w-auto" />
          ) : (
            shopName
          )}
        </Link>

        <nav className="flex items-center gap-5 text-sm">
          <Link href={`/${locale}/shop`} className="text-gray-600 hover:text-gray-900">{t('Shop')}</Link>
          <CartBadge locale={locale} />

          {isShopOwner && (
            <Link
              href={`/${locale}/admin`}
              className="rounded bg-gray-900 px-3 py-1 text-white hover:bg-gray-700"
            >
              {t('admin')}
            </Link>
          )}

          {user ? (
            <div className="flex items-center gap-3">
              <Link href={`/${locale}/account/orders`} className="text-gray-600 hover:text-gray-900">
                {t('orders')}
              </Link>
              <span className="text-gray-500 hidden sm:block">{user.email}</span>
              <form action="/api/auth/sign-out" method="POST">
                <button type="submit" className="text-gray-600 hover:text-gray-900 underline">
                  {t('signOut')}
                </button>
              </form>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Link href={`/${locale}/auth/sign-in`} className="text-gray-600 hover:text-gray-900">{t('signIn')}</Link>
              <Link href={`/${locale}/auth/sign-up`} className="rounded bg-black px-3 py-1 text-white hover:bg-gray-800">
                {t('signUp')}
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
# Only what differs per mode (products, the product form, email starters);
# the shared admin pages are already in place from shared-assets/app.
mkdir -p src/app/[locale]/admin
cp -R "$MODE_DIR/admin-components/." src/app/[locale]/admin

# 11) Auth pages (email/password; no magic links)
mkdir -p src/app/[locale]/auth/sign-in src/app/[locale]/auth/sign-up src/app/[locale]/auth/reset-password

# The sign-in and sign-up pages are plain files in shared-assets/app:
# each is a server page that reads the shop's auth settings and hands
# them to a client form (src/components/auth/Sign{In,Up}Form.tsx).


# Auth callback route handler (exchanges Supabase code for session)
mkdir -p src/app/auth/callback
cat > src/app/auth/callback/route.ts <<'EOF'
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { DEFAULT_LOCALE } from '@/i18n/config';
import { safeNextPath } from '@/lib/auth/messages';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Same-site paths only. `${origin}${next}` with next="@evil.com" would
  // otherwise read as https://shop@evil.com, a link to another site.
  const next = safeNextPath(searchParams.get('next'), `/${DEFAULT_LOCALE}`);

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

  // Back to sign-in in the language the link was for, if it says.
  const locale = /^\/([a-z]{2,3}(?:-[a-z]{2})?)(?:\/|$)/.exec(next)?.[1] ?? DEFAULT_LOCALE;
  return NextResponse.redirect(`${origin}/${locale}/auth/sign-in?error=confirmation_failed`);
}
EOF

mkdir -p src/app/[locale]/auth/mfa
cat > src/app/[locale]/auth/mfa/page.tsx <<'EOF'
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { supabase } from '@/lib/supabase/client';
import { authErrorKey, type AuthErrorKey } from '@/lib/auth/messages';

/**
 * Second factor for the shop owner: a six-digit code from an authenticator
 * app. The admin guard sends the owner here when their session is not yet
 * at AAL2. First visit enrols (shows a QR code), later visits verify.
 */
type Stage =
  | { kind: 'loading' }
  | { kind: 'enrol'; factorId: string; qrCode: string; secret: string }
  | { kind: 'verify'; factorId: string }
  | { kind: 'error'; error: AuthErrorKey };

export default function MfaPage() {
  const { locale } = useParams() as { locale: string };
  const router = useRouter();
  const t = useTranslations('Auth');
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<AuthErrorKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fail = (error: { code?: string; message?: string } | null) => {
      console.error('Two-factor setup failed:', error?.code, error?.message);
      if (!cancelled) setStage({ kind: 'error', error: authErrorKey(error ?? {}) ?? 'generic' });
    };

    async function prepare() {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace(`/${locale}/auth/sign-in?method=password`);
        return;
      }

      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) return fail(listError);

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
      if (enrolError || !enrolment) return fail(enrolError);
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
      console.error('Two-factor challenge failed:', challengeError?.code, challengeError?.message);
      setBusy(false);
      setErr(authErrorKey(challengeError ?? {}) ?? 'generic');
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: stage.factorId,
      challengeId: challenge.id,
      code: code.trim()
    });
    if (verifyError) {
      console.error('Two-factor code refused:', verifyError.code, verifyError.message);
      setBusy(false);
      setErr(authErrorKey(verifyError) ?? 'generic');
      return;
    }

    router.push(`/${locale}/admin`);
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold mb-4">{t('mfa.title')}</h1>

      {stage.kind === 'loading' && <p className="text-gray-600">{t('mfa.preparing')}</p>}

      {stage.kind === 'error' && <p className="text-red-600 text-sm" role="alert">{t(`errors.${stage.error}`)}</p>}

      {stage.kind === 'enrol' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">{t('mfa.enrolHint')}</p>
          {/* Supabase returns the QR code as an inline SVG data URL, which
              next/image cannot optimise, so a plain img is the right tag. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={stage.qrCode} alt={t('mfa.qrAlt')} className="mx-auto h-48 w-48" />
          <p className="text-xs text-gray-500 break-all">
            {t('mfa.manualKey')} <code dir="ltr">{stage.secret}</code>
          </p>
        </div>
      )}

      {stage.kind === 'verify' && (
        <p className="text-sm text-gray-600">{t('mfa.verifyHint')}</p>
      )}

      {(stage.kind === 'enrol' || stage.kind === 'verify') && (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="sr-only">{t('code')}</span>
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
          </label>
          {err && <p className="text-red-600 text-sm" role="alert">{t(`errors.${err}`)}</p>}
          <button className="w-full rounded bg-black text-white p-2" disabled={busy}>
            {busy ? t('checking') : stage.kind === 'enrol' ? t('mfa.activate') : t('mfa.continue')}
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
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { supabase } from '@/lib/supabase/client';
import { authErrorKey } from '@/lib/auth/messages';

/**
 * "Forgot your password?": Supabase emails a link that goes through
 * /auth/callback, which signs the person in, and lands on the page that
 * asks for the new password, in the language they asked in.
 */
export default function ResetPasswordPage() {
  const { locale } = useParams() as { locale: string };
  const t = useTranslations('Auth');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const next = `/${locale}/auth/update-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
    });
    setBusy(false);
    if (error) {
      console.error('Password reset failed:', error.code, error.message);
      setErr(t(`errors.${authErrorKey(error) ?? 'generic'}`));
    } else setSent(true);
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold mb-4">{t('reset.title')}</h1>
      {sent ? (
        <p className="text-green-700 text-sm" role="status">{t('reset.sent')}</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <p className="text-sm text-gray-600">{t('reset.hint')}</p>
          <label className="block text-sm">
            <span className="sr-only">{t('email')}</span>
            <input className="w-full border p-2 rounded" placeholder={t('email')} type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/>
          </label>
          {err && <p className="text-red-600 text-sm" role="alert">{err}</p>}
          <button className="w-full rounded bg-black text-white p-2" disabled={busy}>{busy ? t('sending') : t('reset.submit')}</button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-gray-500">
        <Link href={`/${locale}/auth/sign-in?method=password`} className="underline">
          {t('reset.backToSignIn')}
        </Link>
      </p>
    </main>
  );
}
EOF

mkdir -p src/app/[locale]/auth/update-password
cat > src/app/[locale]/auth/update-password/page.tsx <<'EOF'
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { supabase } from '@/lib/supabase/client';
import { authErrorKey } from '@/lib/auth/messages';

/**
 * The end of "forgot your password?". The reset link went through
 * /auth/callback, so the person arrives signed in; this page only sets the
 * new password. Without a session (an old or reused link) it says so and
 * offers a new link instead of a form that cannot work.
 */
export default function UpdatePasswordPage() {
  const { locale } = useParams() as { locale: string };
  const t = useTranslations('Auth');
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setHasSession(Boolean(data.user)));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr(t('errors.passwordsDiffer'));
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      console.error('Password update failed:', error.code, error.message);
      setErr(t(`errors.${authErrorKey(error) ?? 'generic'}`));
    } else setDone(true);
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold mb-4">{t('update.title')}</h1>
      {hasSession === false && (
        <p className="text-sm text-gray-600">
          {t('update.noSession')}{' '}
          <Link href={`/${locale}/auth/reset-password`} className="underline">
            {t('update.requestNew')}
          </Link>
        </p>
      )}
      {hasSession && done && (
        <p className="text-green-700 text-sm" role="status">
          {t('update.done')}{' '}
          <Link href={`/${locale}`} className="underline">
            {t('update.continue')}
          </Link>
        </p>
      )}
      {hasSession && !done && (
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm">
            <span className="sr-only">{t('password')}</span>
            <input className="w-full border p-2 rounded" placeholder={t('password')} type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required/>
          </label>
          <label className="block text-sm">
            <span className="sr-only">{t('confirmPassword')}</span>
            <input className="w-full border p-2 rounded" placeholder={t('confirmPassword')} type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required/>
          </label>
          {err && <p className="text-red-600 text-sm" role="alert">{err}</p>}
          <button className="w-full rounded bg-black text-white p-2" disabled={busy}>{busy ? t('saving') : t('update.submit')}</button>
        </form>
      )}
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
# Signs the newsletter's confirm and unsubscribe links. Changing it breaks
# every link already sent, so keep it once the shop has subscribers.
ensure_env_default "EMAIL_SIGNING_SECRET" "$(openssl rand -hex 32 2>/dev/null || od -An -N32 -tx1 /dev/urandom | tr -d " \n")"

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
echo "  • Migrations applied: $(ls supabase/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ') files in supabase/migrations/"
echo "  • Storage bucket: product-images (public read + authenticated upload policies)"
if [ -f "$MODE_DIR/seeds.sql" ]; then
  echo "  • Seed data source: $MODE_DIR/seeds.sql"
fi
if [ "$NEXT_PUBLIC_STORE_MODE" = "single" ] && [ -f "$MODE_DIR/brand-single.sql" ]; then
  echo "  • Default brand seeded for single-store setups."
fi
echo "  • New accounts are customers; promote the owner via the SQL editor (see above)"
