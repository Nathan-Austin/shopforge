#!/usr/bin/env bash
# Applies each store mode's schema and lib/storage-policies.sql to a scratch
# Postgres, twice (both must be idempotent), then runs the SQL tests in
# test/sql/ against it: row-level security and the checks that back up the
# app's own validation.
#
#   test/check-schema.sh [--mode=generic|chilli|all] [--tmp-dir=/tmp/sf-<name>-...]
#
# Needs Docker (postgres:16). Supabase itself is not needed: test/supabase-stub.sql
# provides auth.users, auth.uid() and the API roles. The database files
# live under --tmp-dir (default: a fresh mktemp directory) and the
# container is removed afterwards.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODES="generic chilli"
TMP_DIR=""
for arg in "$@"; do
  case $arg in
    --mode=all) MODES="generic chilli" ;;
    --mode=*) MODES="${arg#--mode=}" ;;
    --tmp-dir=*) TMP_DIR="${arg#--tmp-dir=}" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker is required (it runs postgres:16)." >&2
  exit 1
fi

if [ -n "$TMP_DIR" ]; then
  case "$TMP_DIR" in
    /tmp/sf-*) ;;
    *) echo "--tmp-dir must be a /tmp/sf-* directory, got '$TMP_DIR'" >&2; exit 2 ;;
  esac
  mkdir -p "${TMP_DIR%/}/build"
  DATA_DIR=$(mktemp -d "${TMP_DIR%/}/build/schema-check.XXXXXX")
else
  DATA_DIR=$(mktemp -d -t shopforge-schema-check.XXXXXX)
fi
CONTAINER="shopforge-schema-check-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

# Run as the calling user, so the data files can be removed afterwards.
docker run -d --name "$CONTAINER" --user "$(id -u):$(id -g)" \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e PGDATA=/pgdata \
  -v "$DATA_DIR:/pgdata" -v /etc/passwd:/etc/passwd:ro postgres:16 >/dev/null

# The image restarts the server once after initdb; wait for the real one.
for _ in $(seq 1 60); do
  if docker logs "$CONTAINER" 2>&1 | grep -q "init process complete" \
    && docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql_in() {
  docker exec -i "$CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 "$@"
}

for mode in $MODES; do
  echo "=== $mode"
  psql_in -c "create database shop_$mode" >/dev/null
  psql_in -d "shop_$mode" < "$ROOT/test/supabase-stub.sql"
  for pass in first second; do
    if ! psql_in -d "shop_$mode" < "$ROOT/store-modes/$mode/schema.sql" > /dev/null 2>"$DATA_DIR/err.log"; then
      grep -v NOTICE "$DATA_DIR/err.log" >&2
      echo "❌ $mode schema failed to apply ($pass pass)." >&2
      exit 1
    fi
  done
  echo "schema applied twice"
  for pass in first second; do
    if ! psql_in -d "shop_$mode" < "$ROOT/lib/storage-policies.sql" > /dev/null 2>"$DATA_DIR/err.log"; then
      grep -v NOTICE "$DATA_DIR/err.log" >&2
      echo "❌ storage policies failed to apply ($pass pass)." >&2
      exit 1
    fi
  done
  echo "storage policies applied twice"
  for test in "$ROOT"/test/sql/*.sql; do
    if ! psql_in -d "shop_$mode" < "$test" 2>"$DATA_DIR/err.log"; then
      grep -v NOTICE "$DATA_DIR/err.log" >&2
      echo "❌ $mode: $(basename "$test") failed." >&2
      exit 1
    fi
  done
done

echo
echo "✅ Schemas apply cleanly and the SQL tests pass."
