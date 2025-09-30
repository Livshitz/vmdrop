#!/bin/bash
set -e

# Bumps patch version
# for example: 1.2.3 -> 1.2.4
#
# Usage:
#   ./ops/bump.sh

# ---

# Path to package.json
PACKAGE_JSON_PATH="package.json"

# Read current version
current_version=$(cat $PACKAGE_JSON_PATH | grep '"version":' | sed 's/.*: "\(.*\)".*/\1/')
echo "Current version: $current_version"

# Bump patch version
IFS='.' read -r -a version_parts <<< "$current_version"
((version_parts[2]++))
new_version="${version_parts[0]}.${version_parts[1]}.${version_parts[2]}"
echo "New version: $new_version"

# Update package.json (using sed for simplicity and portability)
# Note: This is a simple sed command, for more complex JSON manipulation a tool like jq would be better
sed -i.bak "s/\"version\": \"$current_version\"/\"version\": \"$new_version\"/" $PACKAGE_JSON_PATH && rm ${PACKAGE_JSON_PATH}.bak

echo "Version bumped successfully in $PACKAGE_JSON_PATH"
