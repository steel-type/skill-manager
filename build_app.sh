#!/bin/bash
# Build a clickable macOS .app wrapper that launches skill-manager.py
# in the cloned repo's .venv. Run from inside the cloned repo.
set -e

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_NAME="skill-manager"
APP_PATH="$REPO_DIR/$APP_NAME.app"

if [ ! -d "$REPO_DIR/.venv" ]; then
  echo "No .venv found in $REPO_DIR."
  echo "Run this first:"
  echo "  python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

# Remove old app if it exists
rm -rf "$APP_PATH"

# Build a one-line AppleScript that runs the script with the repo's venv python
SCRIPT="do shell script \"'$REPO_DIR/.venv/bin/python3' '$REPO_DIR/skill-manager.py' > /dev/null 2>&1 &\""

# Compile to a .app bundle
osacompile -o "$APP_PATH" -e "$SCRIPT"

echo "Built $APP_PATH"
echo "Drag it to /Applications or anywhere you want, then double-click to launch."
