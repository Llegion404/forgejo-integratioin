#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [major|minor|patch]"
  echo "  Bumps the version in package.json, commits, and tags."
  echo "  Defaults to 'patch' if no argument given."
  exit 1
}

BUMP="${1:-patch}"

case "$BUMP" in
  major|minor|patch) ;;
  -h|--help) usage ;;
  *) echo "Error: invalid bump type '$BUMP'" >&2; usage ;;
esac

# Ensure we're at the repo root (where package.json lives)
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Read current version
CURRENT="$(node -p "require('./package.json').version")"
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

echo "Bumping version: ${CURRENT} -> ${NEW_VERSION} (${BUMP})"

# Update package.json via npm (also updates package-lock.json if present)
npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version

# Stage, commit, and tag
git add package.json package-lock.json 2>/dev/null || git add package.json
git commit -m "chore: bump version to v${NEW_VERSION}"
git tag -a "v${NEW_VERSION}" -m "v${NEW_VERSION}"

echo "Done. Created commit and tag v${NEW_VERSION}"
echo "Run 'git push && git push --tags' to publish."
