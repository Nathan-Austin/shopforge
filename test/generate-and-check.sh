#!/usr/bin/env bash
# Generates a store without touching Supabase, then runs the checks a first
# deploy on Vercel would: install, type-check, lint and build.
#
#   test/generate-and-check.sh [--mode=generic|chilli] [--shipping=form|stripe] [--auth=password|otp] [--admin-mfa=required|off] [--locales=en,de,ar] [--suffix=name] [--keep]
#
# The store is written to test-<mode><suffix>/ in the repository root
# (gitignored) and removed afterwards unless --keep is given. --locales
# takes the generator's locale list (markets like de-at included). Needs
# Node, pnpm and python3.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODE="generic"
SHIPPING="form"
AUTH="password"
ADMIN_MFA="required"
LOCALES="en,de,ar"
SUFFIX=""
KEEP="false"
for arg in "$@"; do
  case $arg in
    --mode=*) MODE="${arg#--mode=}" ;;
    --shipping=*) SHIPPING="${arg#--shipping=}" ;;
    --auth=*) AUTH="${arg#--auth=}" ;;
    --admin-mfa=*) ADMIN_MFA="${arg#--admin-mfa=}" ;;
    --locales=*) LOCALES="${arg#--locales=}" ;;
    --suffix=*) SUFFIX="-${arg#--suffix=}" ;;
    --keep) KEEP="true" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

APP="test-$MODE$SUFFIX"
cd "$ROOT"
rm -rf "$APP"

step() { echo; echo "=== $*"; }

step "Generate ($MODE, locales: $LOCALES, customer sign-in: $AUTH, admin 2FA: $ADMIN_MFA)"
SHOPFORGE_CUSTOMER_AUTH="$AUTH" SHOPFORGE_ADMIN_MFA="$ADMIN_MFA" ./create-next-commerce-template-ssr.sh "$APP" en "$LOCALES" --mode="$MODE" --skip-supabase

cd "$APP"

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
BUILD_LOG=$(mktemp -t "shopforge-build-$MODE.XXXXXX")
pnpm build 2>&1 | tee "$BUILD_LOG"

# The proxy (locale routing) is registered by file convention, and a
# misplaced src/proxy.ts is ignored without any warning, so assert the
# build actually picked it up.
if ! grep -q "Proxy (Middleware)" "$BUILD_LOG"; then
  echo "❌ Build output has no proxy: locale routing would not run." >&2
  echo "   Expected src/proxy.ts to be picked up by Next." >&2
  exit 1
fi

# The storefront routes the product cards link to. A page file in the wrong
# folder would not fail the build either, so check the route table.
for route in "/\[locale\]/shop" "/\[locale\]/shop/\[slug\]" "/\[locale\]/admin/orders/\[id\]" "/sitemap.xml" "/robots.txt" "/api/feeds/google/\[locale\]"; do
  # ƒ is a dynamic route, ○ a static one; robots.txt is static.
  if ! grep -qE "[ƒ○] +$route\$" "$BUILD_LOG"; then
    echo "❌ Build output has no $route route." >&2
    exit 1
  fi
done

cd "$ROOT"
if [ "$KEEP" != "true" ]; then
  rm -rf "$APP"
fi
rm -f "$BUILD_LOG"

echo
echo "✅ $MODE store generated, type-checked, linted and built."
