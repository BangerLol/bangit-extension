#!/usr/bin/env bash
#
# Verify that a published extension was built from this source code.
#
# Usage:
#   ./scripts/verify-build.sh                     # Rebuild and print hashes
#   ./scripts/verify-build.sh /path/to/unpacked    # Rebuild and compare against an unpacked extension

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$SCRIPT_DIR/build-artifacts.sh"
BUILD_FILES=("${ALL_SHIPPED_FILES[@]}")
COMPARE_DIR="${1:-}"

EXPECTED_BUN="1.3.3"

echo "=== Bangit Extension Build Verification ==="
echo ""
echo "Source: $(git -C "$PROJECT_DIR" describe --tags --always --dirty 2>/dev/null || echo 'unknown')"

LOCAL_BUN="$(bun --version 2>/dev/null || echo 'not found')"
echo "Bun:    $LOCAL_BUN (CI uses $EXPECTED_BUN)"
if [ "$LOCAL_BUN" != "$EXPECTED_BUN" ]; then
    echo "WARNING: Bun version mismatch — hashes may differ from CI builds."
fi

# Build from source
echo "Building from source..."
cd "$PROJECT_DIR"
bun install --frozen-lockfile --silent
bun run build

echo ""

if [ -z "$COMPARE_DIR" ]; then
    # No comparison target — just print hashes
    echo "=== Build artifact hashes (SHA-256) ==="
    echo ""
    cd "$PROJECT_DIR/$BUILD_OUTPUT_DIR"
    for file in "${BUILD_FILES[@]}"; do
        [ -f "$file" ] && sha256sum "$file"
    done
    echo ""
    echo "Compare these against the SHA256SUMS in the GitHub Release."
    exit 0
fi

# Compare mode
echo "Comparing against: $COMPARE_DIR"
echo ""

MISSING=0
for file in "${BUILD_FILES[@]}"; do
    if [ ! -f "$COMPARE_DIR/$file" ]; then
        echo "MISSING: $COMPARE_DIR/$file"
        MISSING=1
    fi
done
if [ "$MISSING" -eq 1 ]; then
    echo ""
    echo "ERROR: Some build artifacts missing. If comparing against a CRX:"
    echo "  unzip extension.crx -d unpacked/"
    echo "  ./scripts/verify-build.sh unpacked/"
    exit 1
fi

cd "$PROJECT_DIR/$BUILD_OUTPUT_DIR"

PASS=0
FAIL=0
for file in "${BUILD_FILES[@]}"; do
    [ -f "$file" ] || continue
    HASH_BUILT=$(sha256sum "$file" | cut -d' ' -f1)
    HASH_PUBLISHED=$(sha256sum "$COMPARE_DIR/$file" | cut -d' ' -f1)

    if [ "$HASH_BUILT" = "$HASH_PUBLISHED" ]; then
        echo "PASS  $file  $HASH_BUILT"
        PASS=$((PASS + 1))
    else
        echo "FAIL  $file"
        echo "      built:     $HASH_BUILT"
        echo "      published: $HASH_PUBLISHED"
        FAIL=$((FAIL + 1))
    fi
done

echo ""
echo "=== $PASS passed, $FAIL failed ==="

[ "$FAIL" -eq 0 ] && echo "The published extension matches this source." && exit 0
exit 1
