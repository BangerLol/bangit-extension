#!/bin/bash

# Bangit Chrome Extension Packaging Script
# Creates a deterministic ZIP file ready for Chrome Web Store submission.
#
# Deterministic builds: same source + same dependencies = same ZIP hash.
# This lets anyone verify the published extension matches the open-source code.

set -euo pipefail

EXTENSION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_FILE="bangit-extension.zip"

cd "$EXTENSION_DIR"

source "$EXTENSION_DIR/scripts/build-artifacts.sh"

# Build from source to ensure artifacts are fresh
echo "Building from source..."
bun run build

# Verify no forbidden patterns survived in the build output
echo "Checking for forbidden patterns..."
"$EXTENSION_DIR/scripts/check-forbidden-patterns.sh"

# Remove existing ZIP if present
rm -f "$OUTPUT_FILE"

# Fail if Rollup emitted unexpected chunks (catches Privy dependency changes)
UNEXPECTED=$(ls "$BUILD_OUTPUT_DIR"/*.js 2>/dev/null | xargs -n1 basename | grep -v -E '^(options|offscreen|vendor|content|popup|background|disabled-.*)\.js$' || true)
if [ -n "$UNEXPECTED" ]; then
  echo "ERROR: Unexpected JS chunks found (likely from Privy code splitting):"
  echo "$UNEXPECTED"
  echo "Add them to the zip list or adjust manualChunks in vite.config.ts"
  exit 1
fi

# --- Deterministic ZIP creation ---
# Use a fixed timestamp so the same build always produces the same ZIP hash.
# Priority: SOURCE_DATE_EPOCH env var > git HEAD commit time > fixed fallback
if [ -z "${SOURCE_DATE_EPOCH:-}" ]; then
  SOURCE_DATE_EPOCH=$(git log -1 --format=%ct 2>/dev/null || echo "0")
fi
export SOURCE_DATE_EPOCH

TOUCH_TIME=$(TZ=UTC date -d "@$SOURCE_DATE_EPOCH" +%Y%m%d%H%M.%S 2>/dev/null || \
             TZ=UTC date -r "$SOURCE_DATE_EPOCH" +%Y%m%d%H%M.%S 2>/dev/null || \
             echo "202501010000.00")

# Normalize file timestamps (ALL_SHIPPED_FILES is pre-sorted in build-artifacts.sh)
cd "$BUILD_OUTPUT_DIR"
for file in "${ALL_SHIPPED_FILES[@]}"; do
  touch -t "$TOUCH_TIME" "$file"
done
find . -type d -exec touch -t "$TOUCH_TIME" {} +

# -X strips extra file attributes (uid/gid) that vary between machines
# -9 max compression (deterministic at the same level)
# Files passed in sorted order for deterministic entry ordering
TZ=UTC zip -X -9 "$EXTENSION_DIR/$OUTPUT_FILE" "${ALL_SHIPPED_FILES[@]}"
cd "$EXTENSION_DIR"

ZIP_HASH=$(sha256sum "$OUTPUT_FILE" | cut -d' ' -f1)

echo ""
echo "=== Package created ==="
echo "File:    $OUTPUT_FILE"
echo "Version: $(grep -oP '"version"\s*:\s*"\K[^"]+' "$BUILD_OUTPUT_DIR/manifest.json")"
echo "SHA-256: $ZIP_HASH"
echo ""
echo "Files included:"
unzip -l "$OUTPUT_FILE"
echo ""
echo "Ready to upload to Chrome Web Store!"
