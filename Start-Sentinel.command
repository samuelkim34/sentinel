#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 24 LTS (24.15 or newer), then reopen this launcher.'
else
  node scripts/launch.mjs
fi
printf '%s\n' 'Press Enter to close.'
read -r answer
