#!/usr/bin/env bash
#
# Copy static (non-Vite) files into the dist/ build directory.
# Runs once before the Vite build targets.
#
# Usage:  bash scripts/build-static.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$SCRIPT_DIR/build-artifacts.sh"

DEST="$PROJECT_DIR/$BUILD_OUTPUT_DIR"

rm -rf "$DEST"
mkdir -p "$DEST/fonts" "$DEST/media"

for file in "${STATIC_FILES[@]}"; do
  cp "$PROJECT_DIR/$file" "$DEST/$file"
done

echo "Copied ${#STATIC_FILES[@]} static files to $BUILD_OUTPUT_DIR/"
