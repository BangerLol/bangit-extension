#!/usr/bin/env bash
#
# Check built JS files for forbidden patterns that violate Chrome Web Store
# Manifest V3 policies (remote code, telemetry eval, etc.).
#
# Exit 0 = clean, Exit 1 = forbidden patterns found.
#
# Usage:  ./scripts/check-forbidden-patterns.sh [build_dir]
#         build_dir defaults to the repo root (where built JS lives).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${1:-$REPO_ROOT/dist}"

# Files that include Privy SDK code (background.js and content.js don't).
TARGET_FILES=(
  vendor.js
  popup.js
  options.js
  offscreen.js
)

# Fixed-string patterns that must not appear in shipped JS.
FORBIDDEN_PATTERNS=(
  "challenges.cloudflare.com"
  "js.hcaptcha.com"
  "telegram-login.js"
  "pay.coinbase.com"
  "explorer-api.walletconnect.com"
  "relay.walletconnect.com"
)

# Regex patterns for more complex checks.
# The ClientAnalytics inline bundle is an ~84KB string assigned as
# variable = '!function(e,t){...ClientAnalytics...}' then injected via textContent.
# Method names like _getOrGenerateClientAnalyticsId are harmless references.
FORBIDDEN_REGEX_PATTERNS=(
  "'!function\(e,t\)\{"
)
FORBIDDEN_REGEX_LABELS=(
  "ClientAnalytics inline eval bundle"
)

found=0

for file in "${TARGET_FILES[@]}"; do
  filepath="$BUILD_DIR/$file"
  if [[ ! -f "$filepath" ]]; then
    echo "WARN: $file not found in $BUILD_DIR (skipped)"
    continue
  fi

  for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
    if grep -qF "$pattern" "$filepath"; then
      echo "FAIL: '$pattern' found in $file"
      found=1
    fi
  done

  for i in "${!FORBIDDEN_REGEX_PATTERNS[@]}"; do
    if grep -qP "${FORBIDDEN_REGEX_PATTERNS[$i]}" "$filepath"; then
      echo "FAIL: ${FORBIDDEN_REGEX_LABELS[$i]} found in $file"
      found=1
    fi
  done
done

if [[ $found -ne 0 ]]; then
  echo ""
  echo "ERROR: Forbidden patterns detected in build output."
  echo "The Vite strip-remote-urls plugin or module aliases may need updating."
  exit 1
fi

echo "OK: No forbidden patterns found in build output."
