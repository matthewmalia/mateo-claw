#!/bin/bash
# Wrapper that launchd executes. Sources nvm so node version upgrades don't
# require editing the plist. Replaces itself with the node process via exec.

set -e

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$(dirname "$0")/.."
exec node dist/index.js
