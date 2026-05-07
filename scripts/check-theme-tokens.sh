#!/usr/bin/env bash
# Theme-token guard. Fail the build if any inline JSX style hardcodes
# `color: "white"` / `color: "black"` / `background: "white"` etc. in src/.
# Forces use of theme tokens (--on-accent, --paper, etc.) so dark mode
# can't drift back into broken state.
#
# Comments and the existing CSS file are exempt.

set -euo pipefail

cd "$(dirname "$0")/.."

# Look only inside src/ (the renderer code that ships theming).
# Catches direct (`color: "white"`) and conditional (`color: x ? "white"`)
# forms. Excludes src/styles/ since the CSS is the source of truth.
matches=$(grep -rnE \
  "['\"](white|black|#fff|#FFF|#ffffff|#FFFFFF|#000|#000000)['\"]" \
  src/ 2>/dev/null \
  | grep -vE "^src/styles/" \
  | grep -vE "whiteSpace|white-space|whitespace" \
  || true)

if [[ -n "$matches" ]]; then
  echo "Theme-token guard: hardcoded white/black colors found in src/." >&2
  echo "Use theme tokens instead (--on-accent, --on-good, --on-warn, --paper, --ink)." >&2
  echo "" >&2
  echo "$matches" >&2
  exit 1
fi

echo "Theme-token guard: OK"
