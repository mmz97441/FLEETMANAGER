#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install Node.js dependencies
npm install

# Ensure vite and tsc are available via npx after install
npx vite --version > /dev/null 2>&1
npx tsc --version > /dev/null 2>&1
