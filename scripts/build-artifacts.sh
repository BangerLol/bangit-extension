#!/usr/bin/env bash
#
# Canonical list of build artifacts shipped in the extension.
# Source this file from other scripts to avoid duplicating the list.
#
# Usage:  source "$(dirname "$0")/build-artifacts.sh"

# Directory where `bun run build` writes the self-contained extension.
BUILD_OUTPUT_DIR="dist"

# Static files (non-Vite) that build-static.sh copies into dist/.
STATIC_FILES=(
  manifest.json
  popup.html
  options.html
  offscreen.html
  content.css
  popup.css
  disabled-remote.js
  disabled-telegram.js
  disabled-hcaptcha.js
  fonts/Rubik-Variable.woff2
  media/icon-rounded-16.png
  media/icon-rounded-48.png
  media/icon-rounded-128.png
  media/bangitLogoNew-rounded-192x192.png
)

# Build outputs: JS/CSS, static HTML, and the manifest.
VERIFY_FILES=(
  background.js
  content.js
  content.css
  popup.css
  popup.js
  offscreen.js
  options.js
  vendor.js
  disabled-remote.js
  disabled-telegram.js
  disabled-hcaptcha.js
  popup.html
  options.html
  offscreen.html
  manifest.json
)

# Non-code assets shipped in the ZIP. List individual files only (no directories).
PACKAGE_ASSET_FILES=(
  fonts/Rubik-Variable.woff2
  media/icon-rounded-16.png
  media/icon-rounded-48.png
  media/icon-rounded-128.png
  media/bangitLogoNew-rounded-192x192.png
)

# Every file shipped in the packaged extension, sorted for deterministic hashing.
ALL_SHIPPED_FILES=($(printf '%s\n' "${VERIFY_FILES[@]}" "${PACKAGE_ASSET_FILES[@]}" | sort))
