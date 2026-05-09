#!/usr/bin/env bash
#
# Build assets/icon.icns from either assets/icon.svg (rasterised via
# qlmanage) or assets/icon.png (used directly). macOS-built-in tools only.

set -euo pipefail

cd "$(dirname "$0")/.."

SVG="assets/icon.svg"
PNG_SRC="assets/icon.png"
DST="assets/icon.icns"

WORK="$(mktemp -d)"
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"
trap 'rm -rf "$WORK"' EXIT

PNG="$WORK/master.png"
if [[ -f "$SVG" ]]; then
  command -v qlmanage >/dev/null 2>&1 || { echo "qlmanage not found — macOS only" >&2; exit 1; }
  echo "Rendering $SVG at 1024×1024…"
  qlmanage -t -s 1024 -o "$WORK" "$SVG" >/dev/null 2>&1
  RENDERED="$WORK/$(basename "$SVG").png"
  [[ -f "$RENDERED" ]] || { echo "qlmanage produced no PNG (looked for $RENDERED)" >&2; exit 1; }
  sips -z 1024 1024 "$RENDERED" --out "$PNG" >/dev/null
elif [[ -f "$PNG_SRC" ]]; then
  echo "Using $PNG_SRC as source (no SVG present)…"
  sips -z 1024 1024 "$PNG_SRC" --out "$PNG" >/dev/null
else
  echo "Missing both $SVG and $PNG_SRC" >&2
  exit 1
fi

# Apple expects this exact set of sizes / @2x suffixes
SIZES_AND_NAMES=(
  "16:icon_16x16.png"
  "32:icon_16x16@2x.png"
  "32:icon_32x32.png"
  "64:icon_32x32@2x.png"
  "128:icon_128x128.png"
  "256:icon_128x128@2x.png"
  "256:icon_256x256.png"
  "512:icon_256x256@2x.png"
  "512:icon_512x512.png"
  "1024:icon_512x512@2x.png"
)

for entry in "${SIZES_AND_NAMES[@]}"; do
  size="${entry%%:*}"
  name="${entry#*:}"
  sips -z "$size" "$size" "$PNG" --out "$ICONSET/$name" >/dev/null
done

# (PNG above is the rendered/copied 1024 master inside $WORK.)

echo "Packing iconset → $DST"
iconutil -c icns "$ICONSET" -o "$DST"
echo "✓ Built $DST"
