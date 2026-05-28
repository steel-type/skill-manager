#!/usr/bin/env bash
# Smoke-test the packed main bundle.
#
# Why this exists: typecheck + vitest + theme-lint all pass on bundles
# that die at runtime (CJS require() in an ESM module, missing imports,
# broken dynamic-import paths). The packed app shipped, the user
# double-clicked, and the JavaScript-error dialog popped. Never again.
#
# How it works: spawns Electron pointed at the just-built dist-electron/
# bundle with SKILLBASE_SMOKE_TEST=1. Main.ts checks that flag and exits
# 0 after bootstrap() completes, OR 1 if bootstrap throws. The bundle
# only gets that far if every top-level import resolved cleanly.
#
# We watch for a sentinel line on stdout. Three failure modes:
#   - process exits with non-zero before sentinel -> bad bootstrap
#   - process exits before sentinel printed -> bad load
#   - 30s timeout (likely Electron's "JavaScript error" dialog blocking
#     the process) -> bad load
#
# A temporary userData dir keeps the smoke from touching the user's
# real ~/.claude config or library.

set -uo pipefail
cd "$(dirname "$0")/.."

TMP_USERDATA=$(mktemp -d)
OUT=$(mktemp)
cleanup() {
  rm -rf "$TMP_USERDATA" "$OUT"
}
trap cleanup EXIT

SENTINEL_OK="SKILLBASE_SMOKE_TEST: bootstrap ok"
SENTINEL_FAIL="SKILLBASE_SMOKE_TEST: bootstrap failed"
TIMEOUT=30

SKILLBASE_SMOKE_TEST=1 \
  ./node_modules/.bin/electron . \
    --user-data-dir="$TMP_USERDATA" \
    --no-sandbox \
    --disable-gpu \
    > "$OUT" 2>&1 &
PID=$!

# Poll once a second up to TIMEOUT for the sentinel or an early exit.
for _ in $(seq 1 "$TIMEOUT"); do
  if grep -q "$SENTINEL_OK" "$OUT"; then
    # Bundle loaded, bootstrap completed cleanly. Tear down whether or
    # not the process has already exited on its own.
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
    echo "smoke: OK (main bundle loaded, bootstrap completed)"
    exit 0
  fi
  if grep -q "$SENTINEL_FAIL" "$OUT"; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
    echo "smoke: FAIL (bootstrap threw)" >&2
    sed -n '1,80p' "$OUT" >&2
    exit 1
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    wait "$PID" 2>/dev/null
    CODE=$?
    echo "smoke: FAIL (process exited with code $CODE before sentinel printed — likely a top-level load error)" >&2
    sed -n '1,80p' "$OUT" >&2
    exit 1
  fi
  sleep 1
done

# Timed out — almost always the Electron uncaught-exception dialog
# blocking on user input. Kill hard and surface stderr.
kill -9 "$PID" 2>/dev/null || true
echo "smoke: FAIL (timeout after ${TIMEOUT}s — likely a runtime exception dialog blocking the process)" >&2
sed -n '1,80p' "$OUT" >&2
exit 1
