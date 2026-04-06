#!/usr/bin/env bash
set -euo pipefail

echo "Building..."
npm run build

echo "Syncing to docs/..."
rm -rf docs
cp -r dist docs

echo "Done! Commit the docs/ folder and push to GitHub."
echo "In your repo settings, set GitHub Pages source to: Branch → main, Folder → /docs"
