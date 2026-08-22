#!/usr/bin/env bash
# Claude Chat Relocator launcher for macOS and Linux.
# Double-click it, or run ./start.sh from a terminal.
set -u
cd "$(dirname "$0")"

echo
echo "  Claude Chat Relocator"
echo "  ---------------------"
echo

# ---- 1. Is Node installed? --------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  cat <<'MSG'
  Node.js is not installed, and this app needs it to run.

  1. Go to   https://nodejs.org
  2. Download the "LTS" version and install it
  3. Run this script again

  On macOS with Homebrew you can instead run:  brew install node
MSG
  exit 1
fi

echo "  Node.js $(node -v) found."

# ---- 2. First run? Install the libraries. ------------------------------
if [ ! -d node_modules ]; then
  echo
  echo "  First run - downloading the libraries this needs."
  echo "  This happens once and takes about a minute."
  echo
  if ! npm install --no-audit --no-fund; then
    echo
    echo "  Something went wrong while downloading."
    echo "  Check your internet connection and try again."
    exit 1
  fi
  echo
  echo "  Done."
fi

# ---- 3. Go. ------------------------------------------------------------
echo
echo "  Starting... your browser will open in a moment."
echo "  Leave this window open while you use the app."
echo "  Press Ctrl+C when you are finished."
echo

exec npm start
