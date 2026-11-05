#!/usr/bin/env bash
# Generates a store without touching Supabase, then runs the checks a first
# deploy on Vercel would: install, type-check, lint and build.
#
#   test/generate-and-check.sh [--mode=generic|chilli] [--shipping=form|stripe] [--auth=password|otp] [--admin-mfa=required|off] [--locales=en,de,ar] [--suffix=name] [--tmp-dir=/tmp/sf-<name>-email-builder] [--keep]
#
# The store is written to test-<mode><suffix>/ in the repository root
# (gitignored) and removed afterwards unless --keep is given. --locales
# takes the generator's locale list (markets like de-at included).
#
# --tmp-dir keeps everything the run writes in one directory instead: the
# store, the build log (under build/), and, when the directory is named
# /tmp/sf-<name>-email-builder, the store's EMAIL_TMP_DIR, so its email
# logs and the previews the unit tests render land there too. Needs Node,
# pnpm and python3.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODE="generic"
SHIPPING="form"
AUTH="password"
ADMIN_MFA="required"
LOCALES="en,de,ar"
SUFFIX=""
TMP_DIR=""
KEEP="false"
for arg in "$@"; do
  case $arg in
    --mode=*) MODE="${arg#--mode=}" ;;
    --shipping=*) SHIPPING="${arg#--shipping=}" ;;
    --auth=*) AUTH="${arg#--auth=}" ;;
    --admin-mfa=*) ADMIN_MFA="${arg#--admin-mfa=}" ;;
    --locales=*) LOCALES="${arg#--locales=}" ;;
    --suffix=*) SUFFIX="-${arg#--suffix=}" ;;
    --tmp-dir=*) TMP_DIR="${arg#--tmp-dir=}" ;;
    --keep) KEEP="true" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

APP="test-$MODE$SUFFIX"
APP_DIR="$ROOT/$APP"
if [ -n "$TMP_DIR" ]; then
  case "$TMP_DIR" in
    /tmp/sf-*) ;;
    *) echo "--tmp-dir must be a /tmp/sf-* directory, got '$TMP_DIR'" >&2; exit 2 ;;
  esac
  TMP_DIR="${TMP_DIR%/}"
  mkdir -p "$TMP_DIR/build"
  APP_DIR="$TMP_DIR/$APP"
  if echo "${TMP_DIR##*/}" | grep -Eq '^sf-[a-z0-9]+(-[a-z0-9]+)*-email-builder$'; then
    export EMAIL_TMP_DIR="$TMP_DIR"
  fi
fi
cd "$ROOT"
rm -rf "$APP_DIR"

step() { echo; echo "=== $*"; }

step "Generate ($MODE, locales: $LOCALES, customer sign-in: $AUTH, admin 2FA: $ADMIN_MFA)"
SHOPFORGE_CUSTOMER_AUTH="$AUTH" SHOPFORGE_ADMIN_MFA="$ADMIN_MFA" ./create-next-commerce-template-ssr.sh "$APP_DIR" en "$LOCALES" --mode="$MODE" --skip-supabase

cd "$APP_DIR"

step "Extend ($MODE, shipping address: $SHIPPING)"
"$ROOT/extend-commerce-template.sh" --mode="$MODE" --shipping="$SHIPPING"

step "Install (frozen lockfile, like Vercel)"
pnpm install --frozen-lockfile

step "Type-check"
pnpm exec tsc --noEmit

step "Lint"
pnpm lint

step "Unit tests"
pnpm test

step "Build"
# A per-run log: a fixed /tmp path is overwritten when two generators run
# at once (a CI matrix, or two checkouts on one machine), and the route
# checks below would then read someone else's build.
if [ -n "$TMP_DIR" ]; then
  BUILD_LOG=$(mktemp "$TMP_DIR/build/shopforge-build-$MODE.XXXXXX")
else
  BUILD_LOG=$(mktemp -t "shopforge-build-$MODE.XXXXXX")
fi
pnpm build 2>&1 | tee "$BUILD_LOG"

# The proxy (locale routing) is registered by file convention, and a
# misplaced src/proxy.ts is ignored without any warning, so assert the
# build actually picked it up.
if ! grep -q "Proxy (Middleware)" "$BUILD_LOG"; then
  echo "❌ Build output has no proxy: locale routing would not run." >&2
  echo "   Expected src/proxy.ts to be picked up by Next." >&2
  exit 1
fi

# Turbopack only warns when a dynamic filesystem path makes it trace the
# whole project into the server output (slow deploys, size limits), so
# make that a failure here.
if grep -q "Dynamic filesystem access causes tracing of the whole project" "$BUILD_LOG"; then
  echo "❌ The build traces the whole project into the server output." >&2
  echo "   Scope the path or mark it /*turbopackIgnore: true*/ (see the build log above)." >&2
  exit 1
fi

# The storefront routes the product cards link to. A page file in the wrong
# folder would not fail the build either, so check the route table.
for route in "/\[locale\]/shop" "/\[locale\]/shop/\[slug\]" "/\[locale\]/admin/orders/\[id\]" "/sitemap.xml" "/robots.txt" "/api/feeds/google/\[locale\]" "/\[locale\]/newsletter/confirm" "/\[locale\]/newsletter/unsubscribe" "/api/email/unsubscribe"; do
  # ƒ is a dynamic route, ○ a static one; robots.txt is static.
  if ! grep -qE "[ƒ○] +$route\$" "$BUILD_LOG"; then
    echo "❌ Build output has no $route route." >&2
    exit 1
  fi
done

cd "$ROOT"
if [ "$KEEP" != "true" ]; then
  rm -rf "$APP_DIR"
fi
rm -f "$BUILD_LOG"

echo
echo "✅ $MODE store generated, type-checked, linted and built."
