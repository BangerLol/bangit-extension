#!/bin/bash

# Bangit Chrome Extension Packaging Script
# Creates a ZIP file ready for Chrome Web Store submission

set -e

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

# Create ZIP from canonical file list (flat paths, no dist/ prefix)
cd "$BUILD_OUTPUT_DIR"
zip "$EXTENSION_DIR/$OUTPUT_FILE" "${ALL_SHIPPED_FILES[@]}"
cd "$EXTENSION_DIR"

echo ""
echo "Created: $OUTPUT_FILE"
echo ""
echo "Files included:"
unzip -l "$OUTPUT_FILE"
echo ""
echo "Ready to upload to Chrome Web Store!"
