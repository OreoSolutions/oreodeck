#!/bin/bash

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

"$ROOT_DIR/install.sh"
STATUS=$?

echo
if [ "$STATUS" -eq 0 ]; then
  read -r -p "Installation complete. Press Enter to close..." _
else
  read -r -p "Installation failed. Press Enter to close..." _
fi

exit "$STATUS"
