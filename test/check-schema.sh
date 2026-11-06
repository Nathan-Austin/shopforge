#!/usr/bin/env bash
# Applies each store mode's migration series to a scratch Postgres, in the
# same order the generator writes it, twice (every file must be idempotent and
# the whole series must be replayable), then runs the SQL tests in test/sql/
# against it: row-level security and the checks that back up the app's own
# validation.
#
# The series is the mode's store-modes/<mode>/migrations/ plus the shared
# lib/migrations/, merged by filename with the mode's copy winning — see
# lib/migrations/README.md. Seeds are not applied: they still carry the
# generator's __HEAT_n__ placeholders.
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

# The migration series for a mode, one absolute path per line, in the order
# the generator writes them: shared files from lib/migrations/, overridden by
# a same-named file in the mode's own migrations/.
migration_series() {
  local mode=$1 file key
  declare -A pick=()
  # The mode's directory is read second, so its copy wins a name collision.
  for file in "$ROOT"/lib/migrations/[0-9]*.sql "$ROOT/store-modes/$mode"/migrations/[0-9]*.sql; do
    [ -e "$file" ] || continue
    pick["$(basename "$file")"]="$file"
  done
  [ ${#pick[@]} -eq 0 ] && return 0
  for key in $(printf '%s\n' "${!pick[@]}" | sort); do
    printf '%s\n' "${pick[$key]}"
  done
}

for mode in $MODES; do
  echo "=== $mode"
  mapfile -t SERIES < <(migration_series "$mode")
  if [ ${#SERIES[@]} -eq 0 ]; then
    echo "❌ $mode: no migrations found." >&2
    exit 1
  fi
  psql_in -c "create database shop_$mode" >/dev/null
  psql_in -d "shop_$mode" < "$ROOT/test/supabase-stub.sql"
  for pass in first second; do
    for migration in "${SERIES[@]}"; do
      if ! psql_in -d "shop_$mode" < "$migration" > /dev/null 2>"$DATA_DIR/err.log"; then
        grep -v NOTICE "$DATA_DIR/err.log" >&2
        echo "❌ $mode: $(basename "$migration") failed to apply ($pass pass)." >&2
        exit 1
      fi
    done
  done
  echo "${#SERIES[@]} migrations applied twice, in order"
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
