#!/bin/bash
# Install Forgejo VS Code Extension
# Usage: ./install.sh [--skip-compile]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

cd "$PROJECT_ROOT"

SKIP_COMPILE=false
if [[ "$1" == "--skip-compile" ]]; then
    SKIP_COMPILE=true
fi

echo "[Install] Working directory: $PROJECT_ROOT"

# Step 1: Compile (unless skipped)
if [[ "$SKIP_COMPILE" == "false" ]]; then
    echo "[Install] Compiling TypeScript..."
    npm run compile
else
    echo "[Install] Skipping compile (--skip-compile)"
fi

# Step 2: Package
echo "[Install] Packaging extension..."
vsce package --baseImagesUrl https://example.com 2>&1 | tail -3

# Step 3: Find the .vsix file
VSIX_FILE=$(ls -t forgejo-vscode-*.vsix 2>/dev/null | head -1)

if [[ -z "$VSIX_FILE" ]]; then
    echo "[Install] ERROR: No .vsix file found!"
    exit 1
fi

echo "[Install] Found: $VSIX_FILE"

# Step 4: Install
echo "[Install] Installing extension..."
code --install-extension "$VSIX_FILE" --force

echo "[Install] Done! Reload VS Code to activate changes."
echo "[Install] Cmd+Shift+P -> 'Developer: Reload Window'"
