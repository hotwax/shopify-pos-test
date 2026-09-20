#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install the supported Node.js LTS release, then run ./run.sh again." >&2
  exit 1
fi
if ! node -e "const major=Number(process.versions.node.split('.')[0]); if (major < 20) process.exit(1)"; then
  echo "Node.js 20.19+ is required. Upgrade Node.js, then run ./run.sh again." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Reinstall Node.js with npm, then run ./run.sh again." >&2
  exit 1
fi
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Xcode command-line tools are required for iPad testing. Install Xcode and its command-line tools, then run ./run.sh again." >&2
  exit 1
fi

if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ]; then
  echo "Installing pinned dependencies…"
  npm ci
fi

if [ ! -f dist/index.html ] || find ui server shared core scripts -type f -newer dist/index.html -print -quit | grep -q .; then
  echo "Building the local app…"
  npm run build
fi

exec npm run start -- --open
