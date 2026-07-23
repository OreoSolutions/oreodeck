#!/bin/bash

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

"$ROOT_DIR/install.sh"
STATUS=$?

echo
if [ "$STATUS" -eq 0 ]; then
  read -r -p "Installation complete / Cài đặt hoàn tất. Press Enter to close / Nhấn Enter để đóng..." _
else
  read -r -p "Installation failed / Cài đặt thất bại. Press Enter to close / Nhấn Enter để đóng..." _
fi

exit "$STATUS"
