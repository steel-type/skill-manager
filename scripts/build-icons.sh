#!/usr/bin/env bash
#
# Render assets/icon.svg → assets/icon.icns using only macOS-built-in tools.
# Re-run any time you tweak the SVG.

set -euo pipefail

cd "$(dirname "$0")/.."

SRC="assets/icon.svg"
DST="assets/icon.icns"

if [[ ! -f "$SRC" ]]; then
  echo "Missing $SRC" >&2
  exit 1
fi

if ! command -v qlmanage >/dev/null 2>&1; then
  echo "qlmanage not found — this script only runs on macOS" >&2
  exit 1
fi

WORK="$(mktemp -d)"
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"
trap 'rm -rf "$WORK"' EXIT

# QuickLook can rasterise an SVG straight to PNG without any external libs.
echo "Rendering $SRC at 1024×1024…"
qlmanage -t -s 1024 -o "$WORK" "$SRC" >/dev/null 2>&1
PNG="$WORK/$(basename "$SRC").png"
if [[ ! -f "$PNG" ]]; then
  echo "qlmanage produced no PNG (looked for $PNG)" >&2
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

echo "Packing iconset → $DST"
iconutil -c icns "$ICONSET" -o "$DST"
echo "✓ Built $DST"
