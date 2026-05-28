#!/usr/bin/env bash
# Theme-token guard. Fail the build if any renderer code under src/
# hardcodes a color literal (white/black, any hex, rgba(), hsla()) outside
# the design tokens. The previous version only caught white/black/#fff/#000
# literally — which silently let in `rgba(42,42,42,0.45)` modal scrims,
# `#1c1c1c` terminal grounds, and friends.
#
# Strategy:
#   1. Pull every line in src/ that looks like a JSX color literal.
#   2. Filter out src/styles/ (the CSS file is the source of truth).
#   3. Filter out anything inside a `// ` or `/* */` comment, plus the
#      false positives that show up for `white-space`, `currentColor`, and
#      the SVG `fill="none"` patterns in icons.
#
# A line is flagged when it contains:
#   - "white" or "black" string literal
#   - any #xxx / #xxxxxx / #xxxxxxxx
#   - rgb(...) / rgba(...) / hsl(...) / hsla(...)

set -euo pipefail

cd "$(dirname "$0")/.."

PATTERN='(["'\''])(white|black|#[0-9a-fA-F]{3,8})["'\'']|rgba?\(|hsla?\('

matches=$(grep -rnE "$PATTERN" src/ 2>/dev/null \
  | grep -vE "^src/styles/" \
  | grep -vE "whiteSpace|white-space|whitespace" \
  | grep -vE 'currentColor' \
  | grep -vE 'fill=["'\'']none["'\'']' \
  | grep -vE '^[^:]+:[[:space:]]*[0-9]+:[[:space:]]*//' \
  || true)

if [[ -n "$matches" ]]; then
  echo "Theme-token guard: hardcoded color literal in src/." >&2
  echo "Use theme tokens (--paper, --ink, --on-accent, --terminal-bg, --scrim, etc.)." >&2
  echo "" >&2
  echo "$matches" >&2
  exit 1
fi

echo "Theme-token guard: OK"
