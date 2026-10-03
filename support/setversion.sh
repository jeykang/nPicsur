#!/bin/bash

# Sets the version of every package, like `pnpm setversion 0.8.0`. Nothing is
# committed or tagged, the tag goes on master once the change is merged, see
# CONTRIBUTING.md

set -euo pipefail

VERSION=${1:-}
if [ -z "$VERSION" ]; then
  echo "Please specify a version"
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."

for package in . backend frontend shared; do
  (cd "$package" && npm version "$VERSION" --no-git-tag-version --allow-same-version)
done
