#!/bin/bash

# Prints the notes of a release, its section of CHANGELOG.md, for the GitHub
# release. Fails when the changelog has no section for it.
#
# Relative links only work inside the repository, so links to its files point
# to them as they are at the release's tag instead.
#
#   ./support/release-notes.sh 0.7.0

set -euo pipefail

VERSION=${1:-}
if [ -z "$VERSION" ]; then
  echo "Please specify a version, like 0.7.0" >&2
  exit 1
fi

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY=${GITHUB_REPOSITORY:-jeykang/nPicsur}

# From "## <version>" up to the next heading of that level. Leading blank
# lines are dropped here, trailing ones by the command substitution.
NOTES=$(
  awk -v heading="## $VERSION" '
    /^## / {
      if (found) exit
      found = ($0 == heading)
      next
    }
    found
  ' "$SCRIPT_PATH/../CHANGELOG.md" | sed -e '/./,$!d'
)

if [ -z "$NOTES" ]; then
  echo "CHANGELOG.md has no section for $VERSION" >&2
  exit 1
fi

# [text](README.md#anchor), not [text](https://...) or [text](#anchor)
printf '%s\n' "$NOTES" \
  | sed -E "s|\]\(([^):#/][^):]*)\)|](https://github.com/$REPOSITORY/blob/v$VERSION/\1)|g"
