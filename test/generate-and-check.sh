#!/usr/bin/env bash
# Generates a store without touching Supabase, then runs the checks a first
# deploy on Vercel would: install, type-check, lint and build.
#
#   test/generate-and-check.sh [--mode=generic|chilli] [--keep]
#
# The store is written to test-<mode>/ in the repository root (gitignored)
# and removed afterwards unless --keep is given. Needs Node, pnpm and python3.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODE="generic"
KEEP="false"
for arg in "$@"; do
  case $arg in
    --mode=*) MODE="${arg#--mode=}" ;;
    --keep) KEEP="true" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

APP="test-$MODE"
cd "$ROOT"
rm -rf "$APP"

step() { echo; echo "=== $*"; }

step "Generate ($MODE)"
./create-next-commerce-template-ssr.sh "$APP" en "en,de,ar" --mode="$MODE" --skip-supabase

cd "$APP"

step "Extend ($MODE)"
"$ROOT/extend-commerce-template.sh" --mode="$MODE"

step "Install (frozen lockfile, like Vercel)"
pnpm install --frozen-lockfile

step "Type-check"
pnpm exec tsc --noEmit

step "Lint"
pnpm lint

step "Unit tests"
pnpm test

step "Build"
pnpm build 2>&1 | tee /tmp/shopforge-build-$MODE.log

# The proxy (locale routing) is registered by file convention, and a
# misplaced src/proxy.ts is ignored without any warning, so assert the
# build actually picked it up.
if ! grep -q "Proxy (Middleware)" "/tmp/shopforge-build-$MODE.log"; then
  echo "❌ Build output has no proxy: locale routing would not run." >&2
  echo "   Expected src/proxy.ts to be picked up by Next." >&2
  exit 1
fi

cd "$ROOT"
if [ "$KEEP" != "true" ]; then
  rm -rf "$APP"
fi

echo
echo "✅ $MODE store generated, type-checked, linted and built."
