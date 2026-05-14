#!/usr/bin/env bash
set -euo pipefail

PINNED_VERSION="2.4.0"
INSTALL_VERSION="${MAESTRO_VERSION:-$PINNED_VERSION}"

echo "[maestro-setup] Installing Maestro CLI ${INSTALL_VERSION} via the official installer..."
curl -fsSL "https://get.maestro.mobile.dev" | MAESTRO_VERSION="$INSTALL_VERSION" bash

MAESTRO_BIN="$HOME/.maestro/bin/maestro"
if [ ! -x "$MAESTRO_BIN" ]; then
  echo "[maestro-setup] Expected Maestro CLI at $MAESTRO_BIN after install, but it was not found." >&2
  exit 1
fi

INSTALLED_VERSION="$("$MAESTRO_BIN" --version | awk 'NR==1 { print $1 }')"
echo "[maestro-setup] Installed Maestro CLI: ${INSTALLED_VERSION}"

echo "[maestro-setup] Add this to your shell profile if needed:"
echo 'export PATH="$HOME/.maestro/bin:$PATH"'
