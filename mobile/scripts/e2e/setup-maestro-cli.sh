#!/usr/bin/env bash
set -euo pipefail

curl -fsSL "https://get.maestro.mobile.dev" | bash

echo "Maestro installed. Add this to your shell profile if needed:"
echo 'export PATH="$HOME/.maestro/bin:$PATH"'
