#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24+ is required to run this application." >&2
  echo "  Install via Homebrew:  brew install node" >&2
  echo "  Or download installer: https://nodejs.org/" >&2
  exit 1
fi
if ! node -e "const [major,minor]=process.versions.node.split('.').map(Number); const supported=(major===20&&minor>=19)||(major===22&&minor>=12)||major>=24; if (!supported) process.exit(1)"; then
  echo "Node.js 20.19+, 22.12+ or 24+ is required. Your current version is $(node -v)." >&2
  echo "  Upgrade via Homebrew:  brew upgrade node" >&2
  echo "  Or download installer: https://nodejs.org/" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Reinstall Node.js with npm from https://nodejs.org/, then run ./run.sh again." >&2
  exit 1
fi
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Full Xcode is required for iPad testing." >&2
  echo "  Download from App Store: macappstore://apps.apple.com/app/xcode/id497799835" >&2
  echo "  Or from Apple Developer: https://developer.apple.com/xcode/" >&2
  echo "  After installing, launch Xcode once and select it in Xcode Settings → Locations." >&2
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
